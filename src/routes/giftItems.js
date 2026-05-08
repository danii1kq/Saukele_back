const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const createGiftItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
  targetAmountKzt: z
    .preprocess((value) => {
      if (typeof value === "string") {
        return value.trim();
      }
      return value;
    }, z.string().regex(/^\d+(\.\d{1,2})?$/))
    .transform((value) => value.toString()),
  targetAmountEur: z
    .preprocess((value) => {
      if (value === undefined || value === null) return undefined;
      if (typeof value === "string") {
        return value.trim();
      }
      return value;
    }, z.string().regex(/^\d+(\.\d{1,2})?$/).optional())
    .transform((value) => value?.toString()),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().default("MEDIUM"),
});

const statusSchema = z.object({
  status: z.enum(["FUNDED", "PURCHASED", "DELIVERED"]),
});

function buildCursorMeta(items, take) {
  return {
    take,
    count: items.length,
    nextCursor: items.length === take ? items[items.length - 1].id : null,
  };
}

async function loadRegistry(registryId) {
  return prisma.registry.findUnique({ where: { id: Number(registryId) } });
}

function isOwnerOrAdmin(user, registry) {
  return registry.userId === user.id || user.role === "ADMIN";
}

router.post("/registries/:registryId/items", requireAuth, requireRole("REGISTRANT", "ADMIN"), async (req, res, next) => {
  try {
    const registryId = Number(req.params.registryId);
    const parsed = createGiftItemSchema.parse(req.body);
    const registry = await loadRegistry(registryId);
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry)) {
      return res.status(403).json({ error: "Not authorized to add items to this registry" });
    }

    const exchangeRate = await prisma.exchangeRateSnapshot.findFirst({
      where: { fromCurrency: "EUR", toCurrency: "KZT" },
      orderBy: { createdAt: "desc" },
    });
    if (!exchangeRate) {
      return res.status(500).json({ error: "Exchange rate snapshot not available" });
    }

    const item = await prisma.giftItem.create({
      data: {
        registryId,
        title: parsed.title,
        description: parsed.description,
        imageUrl: parsed.imageUrl,
        targetAmountKzt: parsed.targetAmountKzt,
        targetAmountEur: parsed.targetAmountEur,
        exchangeRateAtTime: exchangeRate.rate,
        lockedAt: new Date(),
        priority: parsed.priority,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

router.get("/registries/:registryId/items", requireAuth, async (req, res, next) => {
  try {
    const registryId = Number(req.params.registryId);
    const registry = await loadRegistry(registryId);
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    const status = req.query.status;
    const sort = req.query.sort || "priority";
    const allowedSorts = ["createdAt", "-createdAt", "priority"];
    const orderBy = allowedSorts.includes(sort)
      ? sort.startsWith("-")
        ? { [sort.slice(1)]: "desc" }
        : { [sort]: "asc" }
      : { priority: "asc" };

    const items = await prisma.giftItem.findMany({
      where: {
        registryId,
        ...(status ? { status } : {}),
      },
      orderBy,
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: items, meta: buildCursorMeta(items, take) });
  } catch (error) {
    next(error);
  }
});

router.get("/registries/:registryId/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const registryId = Number(req.params.registryId);
    const itemId = Number(req.params.itemId);
    const item = await prisma.giftItem.findUnique({ where: { id: itemId } });
    if (!item || item.registryId !== registryId) {
      return res.status(404).json({ error: "Gift item not found" });
    }

    const registry = await loadRegistry(registryId);
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(item);
  } catch (error) {
    next(error);
  }
});

router.put("/registries/:registryId/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const registryId = Number(req.params.registryId);
    const itemId = Number(req.params.itemId);
    const parsed = createGiftItemSchema.parse(req.body);
    const item = await prisma.giftItem.findUnique({ where: { id: itemId } });
    if (!item || item.registryId !== registryId) {
      return res.status(404).json({ error: "Gift item not found" });
    }

    const registry = await loadRegistry(registryId);
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (item.status !== "PENDING") {
      return res.status(409).json({ error: "Cannot edit item in its current status" });
    }

    const updated = await prisma.giftItem.update({
      where: { id: itemId },
      data: {
        title: parsed.title,
        description: parsed.description,
        imageUrl: parsed.imageUrl,
        targetAmountKzt: parsed.targetAmountKzt,
        targetAmountEur: parsed.targetAmountEur,
        priority: parsed.priority,
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

router.delete("/registries/:registryId/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const registryId = Number(req.params.registryId);
    const itemId = Number(req.params.itemId);
    const item = await prisma.giftItem.findUnique({ where: { id: itemId } });
    if (!item || item.registryId !== registryId) {
      return res.status(404).json({ error: "Gift item not found" });
    }

    const registry = await loadRegistry(registryId);
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (item.status !== "PENDING") {
      return res.status(409).json({ error: "Cannot delete item in its current status" });
    }

    await prisma.giftItem.delete({ where: { id: itemId } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.patch("/registries/:registryId/items/:itemId/status", requireAuth, async (req, res, next) => {
  try {
    const registryId = Number(req.params.registryId);
    const itemId = Number(req.params.itemId);
    const parsed = statusSchema.parse(req.body);
    const item = await prisma.giftItem.findUnique({ where: { id: itemId } });
    if (!item || item.registryId !== registryId) {
      return res.status(404).json({ error: "Gift item not found" });
    }

    const registry = await loadRegistry(registryId);
    if (!registry) {
      return res.status(404).json({ error: "Registry not found" });
    }
    if (!isOwnerOrAdmin(req.user, registry)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const currentStatus = item.status;
    const requestedStatus = parsed.status;

    if (currentStatus === requestedStatus) {
      return res.status(400).json({ error: "Gift item is already in the requested status" });
    }

    if (currentStatus === "PENDING") {
      if (requestedStatus !== "FUNDED") {
        return res.status(409).json({ error: "Invalid status transition" });
      }
      if (item.currentAmountKzt.lt(item.targetAmountKzt)) {
        return res.status(400).json({ error: "Cannot advance to FUNDED before target amount is reached" });
      }
    } else if (currentStatus === "FUNDED") {
      if (requestedStatus !== "PURCHASED") {
        return res.status(409).json({ error: "Invalid status transition" });
      }
    } else if (currentStatus === "PURCHASED") {
      if (requestedStatus !== "DELIVERED") {
        return res.status(409).json({ error: "Invalid status transition" });
      }
    } else {
      return res.status(409).json({ error: "Cannot change status for this item" });
    }

    const updated = await prisma.giftItem.update({
      where: { id: itemId },
      data: { status: requestedStatus },
    });

    res.json(updated);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

module.exports = router;
