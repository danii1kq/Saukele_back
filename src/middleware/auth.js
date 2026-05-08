const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { accessTokenSecret } = require("../config/config");

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization required" });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, accessTokenSecret);
    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (payload.ver !== user.tokenVersion) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Проверка верификации email (кроме админов, чтобы не заблокировать самих себя)
    if (!user.isVerified && user.role !== "ADMIN") {
      return res.status(403).json({ error: "Email not verified" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authorization required" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
