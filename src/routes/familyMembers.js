const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const familyMemberSchema = z.object({
  relatedUserId: z.number().int().optional(),
  name: z.string().min(1),
  relationshipType: z.enum([
    "PARENT",
    "SIBLING",
    "CHILD",
    "COUSIN",
    "UNCLE_AUNT",
    "FAMILY_FRIEND",
    "OTHER",
  ]),
  kinshipTier: z.enum(["CLOSE", "EXTENDED", "FRIEND"]),
});

function buildCursorMeta(items, take) {
  return {
    take,
    count: items.length,
    nextCursor: items.length === take ? items[items.length - 1].id : null,
  };
}

function getKinshipSuggestion(kinshipTier) {
  const suggested = {
    CLOSE: 100000,
    EXTENDED: 50000,
    FRIEND: 20000,
  };
  return suggested[kinshipTier] || 20000;
}

router.post("/family-members", requireAuth, requireRole("REGISTRANT", "ADMIN"), async (req, res, next) => {
  try {
    const parsed = familyMemberSchema.parse(req.body);
    
    // Логика по умолчанию: если это сам пользователь (создатель реестра), то CLOSE
    let kinshipTier = parsed.kinshipTier;
    if (parsed.relatedUserId === req.user.id) {
      kinshipTier = "CLOSE";
    }

    const created = await prisma.familyMember.create({
      data: {
        userId: req.user.id,
        relatedUserId: parsed.relatedUserId || null,
        name: parsed.name,
        relationshipType: parsed.relationshipType,
        kinshipTier: kinshipTier,
      },
    });
    res.status(201).json(created);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

router.get("/family-members", requireAuth, async (req, res, next) => {
  try {
    const userIdQuery = req.query.userId ? Number(req.query.userId) : null;
    if (userIdQuery && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const userId = userIdQuery || req.user.id;
    const kinshipTier = req.query.kinshipTier;
    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);

    const familyMembers = await prisma.familyMember.findMany({
      where: {
        userId,
        ...(kinshipTier ? { kinshipTier } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: familyMembers, meta: buildCursorMeta(familyMembers, take) });
  } catch (error) {
    next(error);
  }
});

router.delete("/family-members/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const member = await prisma.familyMember.findUnique({ where: { id } });
    if (!member) {
      return res.status(404).json({ error: "Family member entry not found" });
    }
    if (member.userId !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    await prisma.familyMember.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/family-members/kinship-tier/:userId", requireAuth, async (req, res, next) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (Number.isNaN(targetUserId)) {
      return res.status(422).json({ error: "Invalid userId" });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.user.id === targetUserId) {
      return res.json({ kinshipTier: "CLOSE", suggestedMinimumKzt: getKinshipSuggestion("CLOSE") });
    }

    const allMembers = await prisma.familyMember.findMany();
    const byUser = new Map();
    for (const member of allMembers) {
      const list = byUser.get(member.userId) || [];
      list.push(member);
      byUser.set(member.userId, list);
    }

    const queue = [...(byUser.get(req.user.id) || [])];
    const visited = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current.relatedUserId) {
        continue;
      }
      if (current.relatedUserId === targetUserId) {
        return res.json({
          kinshipTier: current.kinshipTier,
          suggestedMinimumKzt: getKinshipSuggestion(current.kinshipTier),
        });
      }
      if (visited.has(current.relatedUserId)) {
        continue;
      }
      visited.add(current.relatedUserId);
      queue.push(...(byUser.get(current.relatedUserId) || []));
    }

    res.json({ kinshipTier: "FRIEND", suggestedMinimumKzt: getKinshipSuggestion("FRIEND") });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
