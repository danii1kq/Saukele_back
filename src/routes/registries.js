const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createRegistrySchema = z.object({
  title: z.string().min(1),
  coupleName: z.string().min(1),
  weddingDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid weddingDate format",
  }),
  isPublic: z.boolean().optional().default(false),
});

async function buildUniqueShareCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = crypto
      .randomBytes(4)
      .toString("base64url")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 8);
    const shareCode = `saukele-${suffix}`;
    const existing = await prisma.registry.findUnique({ where: { shareCode } });
    if (!existing) {
      return shareCode;
    }
  }
  throw new Error("Unable to generate unique share code");
}

function buildOrderBy(sort) {
  const allowedFields = ["createdAt", "weddingDate"];
  const direction = sort?.startsWith("-") ? "desc" : "asc";
  const field = sort?.replace(/^-/, "");
  if (!allowedFields.includes(field)) {
    return { createdAt: "desc" };
  }
  return { [field]: direction };
}

function buildCursorMeta(items, take) {
  return {
    take,
    count: items.length,
    nextCursor: items.length === take ? items[items.length - 1].id : null,
  };
}

function isOwnerOrAdmin(user, resourceOwnerId) {
  return user.id === resourceOwnerId || user.role === "ADMIN";
}

router.get("/", async (req, res, next) => {
  try {
    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    const status = req.query.status;
    const sort = req.query.sort || "-createdAt";
    const where = { isPublic: true };
    if (status) {
      where.status = status;
    }

    const registries = await prisma.registry.findMany({
      where,
      orderBy: buildOrderBy(sort),
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: registries, meta: buildCursorMeta(registries, take) });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, requireRole("REGISTRANT", "ADMIN"), async (req, res, next) => {
  try {
    const parsed = createRegistrySchema.parse(req.body);
    const shareCode = await buildUniqueShareCode();
    const registry = await prisma.registry.create({
      data: {
        userId: req.user.id,
        title: parsed.title,
        coupleName: parsed.coupleName,
        weddingDate: new Date(parsed.weddingDate),
        isPublic: parsed.isPublic,
        shareCode,
      },
    });
    res.status(201).json(registry);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

router.get("/share/:shareCode", async (req, res, next) => {
  try {
    const registry = await prisma.registry.findUnique({
      where: { shareCode: req.params.shareCode },
      include: { giftItems: true },
    });
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    res.json(registry);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const registryId = Number(req.params.id);
    const registry = await prisma.registry.findUnique({ where: { id: registryId } });
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry.userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(registry);
  } catch (error) {
    next(error);
  }
});

router.put("/:id", requireAuth, requireRole("REGISTRANT", "ADMIN"), async (req, res, next) => {
  try {
    const registryId = Number(req.params.id);
    const parsed = createRegistrySchema.parse(req.body);
    const registry = await prisma.registry.findUnique({ where: { id: registryId } });
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry.userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updated = await prisma.registry.update({
      where: { id: registryId },
      data: {
        title: parsed.title,
        coupleName: parsed.coupleName,
        weddingDate: new Date(parsed.weddingDate),
        isPublic: parsed.isPublic,
      },
    });
    res.json(updated);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

router.delete("/:id", requireAuth, requireRole("REGISTRANT", "ADMIN"), async (req, res, next) => {
  try {
    const registryId = Number(req.params.id);
    const registry = await prisma.registry.findUnique({ where: { id: registryId } });
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry.userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const confirmedContributions = await prisma.contribution.count({
      where: {
        giftItem: { registryId },
        status: "CONFIRMED",
      },
    });

    if (confirmedContributions > 0) {
      return res.status(409).json({ error: "Cannot delete registry with confirmed contributions" });
    }

    await prisma.registry.update({
      where: { id: registryId },
      data: { status: "ARCHIVED" },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});


module.exports = router;
