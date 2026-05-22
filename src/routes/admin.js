const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { recordAudit } = require("../lib/audit");

const router = express.Router();

function buildCursorMeta(items, take) {
  return {
    take,
    count: items.length,
    nextCursor: items.length === take ? items[items.length - 1].id : null,
  };
}

function parseSort(sort, allowed, defaultSort) {
  if (!sort) {
    sort = defaultSort;
  }
  const direction = sort.startsWith("-") ? "desc" : "asc";
  const field = sort.replace(/^-/, "");
  if (!allowed.includes(field)) {
    return { [defaultSort.replace(/^-/, "")]: "desc" };
  }
  return { [field]: direction };
}

router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    const role = req.query.role;
    const provider = req.query.provider;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : null;
    const sort = parseSort(req.query.sort, ["createdAt", "email"], "-createdAt");

    const where = {
      ...(role ? { role } : {}),
      ...(provider ? { provider } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const users = await prisma.user.findMany({
      where,
      orderBy: sort,
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ data: users, meta: buildCursorMeta(users, take) });
  } catch (error) {
    next(error);
  }
});

router.get("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [registriesCount, contributionsCount, familyMembersCount] = await Promise.all([
      prisma.registry.count({ where: { userId: id } }),
      prisma.contribution.count({ where: { userId: id } }),
      prisma.familyMember.count({ where: { userId: id } }),
    ]);

    res.json({
      ...user,
      aggregates: {
        registriesCount,
        contributionsCount,
        familyMembersCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return res.status(409).json({ error: "Cannot delete the last ADMIN user" });
      }
    }

    await prisma.refreshToken.deleteMany({ where: { userId: id } });
    await prisma.user.update({
      where: { id },
      data: {
        email: `deleted+${id}@example.com`,
        name: "Deleted user",
        role: "GUEST",
        provider: "local",
        passwordHash: "",
      },
    });

    await recordAudit(prisma, {
      req,
      action: "USER_ANONYMIZED",
      resourceType: "User",
      resourceId: id,
      oldValues: user,
      newValues: {
        email: `deleted+${id}@example.com`,
        name: "Deleted user",
        role: "GUEST",
        provider: "local",
      },
    });

    res.json({ id, message: "User anonymized and disabled" });
  } catch (error) {
    next(error);
  }
});

router.get("/registries", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100);
    const status = req.query.status;
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const sort = parseSort(req.query.sort, ["createdAt", "weddingDate"], "-createdAt");

    const where = {
      ...(status ? { status } : {}),
      ...(userId ? { userId } : {}),
    };

    const registries = await prisma.registry.findMany({
      where,
      orderBy: sort,
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: registries, meta: buildCursorMeta(registries, take) });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/role", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const schema = z.object({ role: z.enum(["GUEST", "REGISTRANT", "ADMIN"]) });
    const parsed = schema.parse(req.body);
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: parsed.role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await recordAudit(prisma, {
      req,
      action: "USER_ROLE_CHANGED",
      resourceType: "User",
      resourceId: id,
      oldValues: { role: user.role },
      newValues: { role: updated.role },
    });

    res.json(updated);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

router.get("/audit-logs", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const cursor = Number(req.query.cursor);
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const resourceType = req.query.resourceType;
    const sort = parseSort(req.query.sort, ["createdAt"], "-createdAt");

    const where = {
      ...(resourceType ? { resourceType } : {}),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: sort,
      take,
      ...(cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    res.json({ data: logs, meta: buildCursorMeta(logs, take) });
  } catch (error) {
    next(error);
  }
});

router.patch("/exchange-rates", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const schema = z.object({
      fromCurrency: z.string().min(3).max(3),
      toCurrency: z.string().min(3).max(3),
      rate: z
        .preprocess((value) => {
          if (typeof value === "string") {
            return value.trim();
          }
          return value;
        }, z.string().regex(/^\d+(\.\d{1,6})?$/)),
      source: z.string().min(1),
    });
    const parsed = schema.parse(req.body);

    const snapshot = await prisma.exchangeRateSnapshot.create({
      data: {
        fromCurrency: parsed.fromCurrency.toUpperCase(),
        toCurrency: parsed.toCurrency.toUpperCase(),
        rate: parsed.rate,
        source: parsed.source,
      },
    });

    await recordAudit(prisma, {
      req,
      action: "EXCHANGE_RATE_CREATED",
      resourceType: "ExchangeRateSnapshot",
      resourceId: snapshot.id,
      newValues: snapshot,
    });

    res.json(snapshot);
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

module.exports = router;
