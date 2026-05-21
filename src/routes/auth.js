const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { authLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/auth");
const { sendEmailAsync } = require("../lib/email");
const config = require("../config/config");

const {
  accessTokenSecret,
  accessTokenExpiresIn,
  refreshTokenExpiresDays,
  bcryptSaltRounds,
} = config;

const router = express.Router();

// Схемы валидации
const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).regex(/^(?=.*\d).+$/, {
    message: "Password must include at least one number",
  }),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).regex(/^(?=.*\d).+$/),
});

// Вспомогательные функции
function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, ver: user.tokenVersion }, accessTokenSecret, {
    expiresIn: accessTokenExpiresIn,
  });
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

async function issueAuthTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = createRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + refreshTokenExpiresDays * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken };
}

function buildUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    provider: user.provider,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// Регистрация (с отправкой письма верификации)
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(parsed.password, bcryptSaltRounds);

    const user = await prisma.user.create({
      data: {
        email: parsed.email,
        name: parsed.name,
        passwordHash,
        isVerified: false, // По умолчанию не подтвержден
      },
    });

    // Создаем токен верификации
    const verificationToken = crypto.randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 часа
      },
    });

    // Отправляем письмо асинхронно через очередь
    const verifyLink = `${req.protocol}://${req.get("host")}/api/auth/verify-email?token=${verificationToken}`;
    await sendEmailAsync({
      to: user.email,
      subject: "Подтверждение регистрации в Saukele",
      text: `Здравствуйте! Перейдите по ссылке для подтверждения email: ${verifyLink}`,
      html: `<p>Здравствуйте!</p><p>Перейдите по ссылке для подтверждения email:</p><a href="${verifyLink}">${verifyLink}</a>`,
    });

    const tokens = await issueAuthTokens(user);
    res.status(201).json({
      message: "Registration successful. Please check your email to verify your account.",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: buildUserPayload(user),
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Email already in use" });
    }
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Переотправка письма верификации
router.post("/resend-verification", authLimiter, async (req, res, next) => {
  try {
    const { email } = resendVerificationSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: "User is already verified" });
    }

    const verifyToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24ч

    // Удаляем предыдущие токены верификации для этого юзера (опционально)
    await prisma.verificationToken.deleteMany({
      where: { userId: user.id },
    });

    await prisma.verificationToken.create({
      data: {
        token: verifyToken,
        userId: user.id,
        expiresAt,
      },
    });

    const verifyLink = `${config.baseUrl}/auth/verify-email?token=${verifyToken}`;
    
    // Асинхронно отправляем письмо
    sendEmailAsync({
      to: user.email,
      subject: "Подтверждение Email (повторно)",
      text: `Перейдите по ссылке для подтверждения email: ${verifyLink}`,
      html: `<p>Здравствуйте!</p><p>Перейдите по ссылке для подтверждения email:</p><a href="${verifyLink}">${verifyLink}</a>`,
    });

    res.json({ message: "Verification email sent successfully." });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Верификация email
router.get("/verify-email", async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.query);

    const storedToken = await prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    // Обновляем пользователя
    await prisma.user.update({
      where: { id: storedToken.userId },
      data: { isVerified: true },
    });

    // Удаляем использованный токен
    await prisma.verificationToken.delete({ where: { id: storedToken.id } });

    res.json({ message: "Email verified successfully. You can now log in." });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Запрос на сброс пароля
router.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isVerified) {
      // Не сообщаем, что пользователь не найден или не подтвержден,
      // чтобы не раскрывать статус учетной записи.
      return res.json({ message: "If your email is registered, you will receive a password reset link." });
    }

    // Создаем токен сброса пароля
    const resetToken = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 час
      },
    });

    const resetLink = `${req.protocol}://${req.get("host")}/api/auth/reset-password?token=${resetToken}`;
    await sendEmailAsync({
      to: user.email,
      subject: "Сброс пароля Saukele",
      text: `Здравствуйте! Для сброса пароля перейдите по ссылке: ${resetLink}`,
      html: `<p>Здравствуйте!</p><p>Для сброса пароля перейдите по ссылке (действует 1 час):</p><a href="${resetLink}">${resetLink}</a>`,
    });

    res.json({ message: "If your email is registered, you will receive a password reset link." });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Сброс пароля
router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    const storedToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken || storedToken.expiresAt < new Date() || storedToken.used) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    // Обновляем пароль
    const passwordHash = await bcrypt.hash(newPassword, bcryptSaltRounds);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: storedToken.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: storedToken.id },
        data: { used: true },
      }),
    ]);

    res.json({ message: "Password reset successful. You can now log in with your new password." });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Логин
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isValid = await bcrypt.compare(parsed.password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const tokens = await issueAuthTokens(user);
    res.json({
      message: "Login successful",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: buildUserPayload(user),
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Обновление токена
router.post("/refresh", async (req, res, next) => {
  try {
    const parsed = refreshSchema.parse(req.body);
    const stored = await prisma.refreshToken.findUnique({
      where: { token: parsed.refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revoked || stored.expiresAt <= new Date()) {
      return res.status(401).json({ error: "Refresh token is invalid or expired" });
    }

    const accessToken = signAccessToken(stored.user);
    res.json({
      message: "Token refreshed successfully",
      accessToken,
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Выход
router.post("/logout", async (req, res, next) => {
  try {
    const parsed = refreshSchema.parse(req.body);
    const stored = await prisma.refreshToken.findUnique({
      where: { token: parsed.refreshToken },
      include: { user: true },
    });

    if (!stored) {
      return res.status(404).json({ error: "Refresh token not found" });
    }

    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { token: parsed.refreshToken } }),
      prisma.user.update({
        where: { id: stored.userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(422).json({ error: "Validation failed", details: error.errors });
    }
    next(error);
  }
});

// Профиль
router.get("/me", requireAuth, (req, res) => {
  res.json(buildUserPayload(req.user));
});

module.exports = router;
