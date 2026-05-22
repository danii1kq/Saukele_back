const { Prisma } = require("@prisma/client");

const REDACTED_KEYS = new Set(["passwordHash", "token", "refreshToken"]);

function normalizeAuditValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Prisma.Decimal || value?.constructor?.name === "Decimal") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeAuditValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        REDACTED_KEYS.has(key) ? "[redacted]" : normalizeAuditValue(nestedValue),
      ])
    );
  }

  return value;
}

async function recordAudit(client, details) {
  const request = details.req || {};
  const userId = details.userId ?? request.user?.id ?? null;

  return client.auditLog.create({
    data: {
      userId,
      action: details.action,
      resourceType: details.resourceType,
      resourceId: Number.isFinite(details.resourceId) ? details.resourceId : Number(details.resourceId) || 0,
      oldValues: normalizeAuditValue(details.oldValues),
      newValues: normalizeAuditValue(details.newValues),
      ipAddress: request.ip || null,
      userAgent: typeof request.get === "function" ? request.get("user-agent") : request.headers?.["user-agent"] || null,
    },
  });
}

module.exports = {
  normalizeAuditValue,
  recordAudit,
};