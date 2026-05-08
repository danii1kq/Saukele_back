const express = require("express");
const { z } = require("zod");
const jwt = require("jsonwebtoken");
const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const { accessTokenSecret } = require("../config/config");

const router = express.Router();

const contributionSchema = z.object({
  contributorName: z.string().min(1),
  amountKzt: z
    .preprocess((value) => {
      if (typeof value === "string") {
        return Number(value.trim());
      }
      return value;
    }, z.number().min(1000)),
  message: z.string().max(1000).optional(),
});

function getUserIdFromBearer(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, accessTokenSecret);
    return Number(payload.sub);
  } catch {
    return null;
  }
}

function buildCursorMeta(items, take) {
  return {
    take,
    count: items.length,
    nextCursor: items.length === take ? items[items.length - 1].id : null,
  };
}

function parseContributionSort(sort) {
  if (!sort || sort === "-createdAt") {
    return { createdAt: "desc" };
  }
  if (sort === "createdAt") {
    return { createdAt: "asc" };
  }
  return { createdAt: "desc" };
}

async function buildKinshipSuggestion(contributorId, ownerId) {
  if (!contributorId) {
    return { kinshipTier: "FRIEND", suggestedMinimumKzt: 20000 };
  }
  const relation = await prisma.familyMember.findFirst({
    where: { userId: ownerId, relatedUserId: contributorId },
  });
  if (!relation) {
    return { kinshipTier: "FRIEND", suggestedMinimumKzt: 20000 };
  }

  const suggested = {
    CLOSE: 100000,
    EXTENDED: 50000,
    FRIEND: 20000,
  };

  return {
    kinshipTier: relation.kinshipTier,
    suggestedMinimumKzt: suggested[relation.kinshipTier] || 20000,
  };
}

router.post("/items/:itemId/contributions", async (req, res, next) => {
  try {
    const parsed = contributionSchema.parse(req.body);
    const itemId = Number(req.params.itemId);
    const giftItem = await prisma.giftItem.findUnique({
      where: { id: itemId },
      include: { registry: true },
    });
    if (!giftItem) {
      return res.status(404).json({ error: "Gift item not found" });
    }
    if (["PURCHASED", "DELIVERED"].includes(giftItem.status)) {
      return res.status(409).json({ error: "Cannot contribute to this gift item" });
    }

    const exchangeRate = await prisma.exchangeRateSnapshot.findFirst({
      where: { fromCurrency: "EUR", toCurrency: "KZT" },
      orderBy: { createdAt: "desc" },
    });
    if (!exchangeRate) {
      return res.status(500).json({ error: "Exchange rate snapshot not available" });
    }

    const contributorId = getUserIdFromBearer(req);
    const amountDecimal = new Prisma.Decimal(parsed.amountKzt);
    const currentAmountDecimal = new Prisma.Decimal(giftItem.currentAmountKzt);
    const targetAmountDecimal = new Prisma.Decimal(giftItem.targetAmountKzt);
    const nextAmount = currentAmountDecimal.add(amountDecimal);

    if (nextAmount.gt(targetAmountDecimal)) {
      return res.status(400).json({ error: "Contribution would exceed target amount" });
    }

    const amountEur = amountDecimal.div(exchangeRate.rate).toFixed(2);
    const lockedAtTimestamp = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.contribution.create({
        data: {
          giftItemId: itemId,
          userId: contributorId || null,
          contributorName: parsed.contributorName,
          amountKzt: amountDecimal,
          amountEur,
          exchangeRateAtTime: exchangeRate.rate,
          lockedAtTimestamp,
          message: parsed.message,
          status: "PENDING",
        },
      });

      const updatedGift = await tx.giftItem.update({
        where: { id: itemId },
        data: {
          currentAmountKzt: nextAmount.toString(),
          status: nextAmount.gte(targetAmountDecimal) ? "FUNDED" : giftItem.status,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: contributorId || null,
          action: "CONTRIBUTION_CREATED",
          resourceType: "GiftItem",
          resourceId: giftItem.id,
          oldValues: { currentAmountKzt: giftItem.currentAmountKzt.toString() },
          newValues: { currentAmountKzt: updatedGift.currentAmountKzt.toString(), status: updatedGift.status },
        },
      });

      return { contribution: created, giftItem: updatedGift };
    });

    const kinshipSuggestion = await buildKinshipSuggestion(contributorId, giftItem.registry.userId);

    res.status(201).json({
      contribution: result.contribution,
      giftItem: result.giftItem,
      kinshipSuggestion,
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

router.get("/items/:itemId/contributions", requireAuth, async (req, res, next) => {
  try {
    const itemId = Number(req.params.itemId);
    const item = await prisma.giftItem.findUnique({
      where: { id: itemId },
      include: { registry: true },
    });
    if (!item) {
      return res.status(404).json({ error: "Gift item not found" });
    }
    if (item.registry.userId !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    const status = req.query.status;
    const sort = parseContributionSort(req.query.sort);

    const contributions = await prisma.contribution.findMany({
      where: {
        giftItemId: itemId,
        ...(status ? { status } : {}),
      },
      orderBy: sort,
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: contributions, meta: buildCursorMeta(contributions, take) });
  } catch (error) {
    next(error);
  }
});

router.get("/contributions/my", requireAuth, async (req, res, next) => {
  try {
    const targetUserId = req.query.userId ? Number(req.query.userId) : req.user.id;
    if (Number.isNaN(targetUserId)) {
      return res.status(422).json({ error: "Invalid userId" });
    }
    if (req.query.userId && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    const status = req.query.status;
    const sort = parseContributionSort(req.query.sort);

    const where = {
      userId: targetUserId,
      ...(status ? { status } : {}),
    };

    const contributions = await prisma.contribution.findMany({
      where,
      orderBy: sort,
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: contributions, meta: buildCursorMeta(contributions, take) });
  } catch (error) {
    next(error);
  }
});

router.get("/contributions/:id", requireAuth, async (req, res, next) => {
  try {
    const contributionId = Number(req.params.id);
    const contribution = await prisma.contribution.findUnique({
      where: { id: contributionId },
      include: {
        giftItem: { include: { registry: true } },
      },
    });
    if (!contribution) {
      return res.status(404).json({ error: "Contribution not found" });
    }
    const ownerId = contribution.giftItem.registry.userId;
    if (req.user.role !== "ADMIN" && contribution.userId !== req.user.id && ownerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(contribution);
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    next(error);
  }
});

module.exports = router;
