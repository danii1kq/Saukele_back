require("dotenv").config();

const requiredEnv = ["DATABASE_URL", "JWT_ACCESS_SECRET"];
for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const defaultOrigins = ["http://localhost:4000", "http://127.0.0.1:4000"];
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(",")).split(",").map((origin) => origin.trim()).filter(Boolean);

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  accessTokenSecret: process.env.JWT_ACCESS_SECRET,
  accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  refreshTokenExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 30),
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),
  port: Number(process.env.PORT || 4000),
  allowedOrigins,

  // Email (Nodemailer)
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  emailFrom: process.env.EMAIL_FROM || "noreply@saukele.kz",

  // Redis (BullMQ)
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
};
