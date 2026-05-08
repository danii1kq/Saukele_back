require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

describe("Auth flow", () => {
  const email = `test+${Date.now()}@example.com`;
  const password = "Test12345";
  let accessToken;
  let refreshToken;

  afterAll(async () => {
    // Удаляем связанные данные в правильном порядке
    const user = await prisma.user.findFirst({ where: { email } });
    if (user) {
      await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  test("registers a new user", async () => {
    const response = await request(app).post("/api/auth/register").send({
      email,
      name: "Test User",
      password,
    });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();
    expect(response.body.user.email).toBe(email);

    // Подтверждаем email для тестов, чтобы проходили проверки isVerified
    const user = await prisma.user.findFirst({ where: { email } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      });
    }

    accessToken = response.body.accessToken;
    refreshToken = response.body.refreshToken;
  });

  test("logs in with created user", async () => {
    const response = await request(app).post("/api/auth/login").send({
      email,
      password,
    });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();
    expect(response.body.user.email).toBe(email);

    accessToken = response.body.accessToken;
    refreshToken = response.body.refreshToken;
  });

  test("returns user profile with valid access token", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(email);
    expect(response.body.role).toBe("GUEST");
  });

  test("refreshes the access token", async () => {
    const response = await request(app).post("/api/auth/refresh").send({
      refreshToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
  });

  test("logs out using refresh token", async () => {
    const response = await request(app).post("/api/auth/logout").send({
      refreshToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Logged out successfully");
  });

  test("invalidates access token after logout", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid token");
  });

  test("removes refresh token after logout", async () => {
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    expect(stored).toBeNull();

    const response = await request(app).post("/api/auth/refresh").send({
      refreshToken,
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Refresh token is invalid or expired");
  });

  test("returns 404 when logging out an already removed token", async () => {
    const response = await request(app).post("/api/auth/logout").send({
      refreshToken,
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Refresh token not found");
  });
});
