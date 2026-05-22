require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

describe("Contribution business flow", () => {
  let accessToken;
  let registry;
  let giftItem;
  const adminEmail = `admin+${Date.now()}@example.com`;

  beforeAll(async () => {
    // Create necessary exchange rate for tests
    await prisma.exchangeRateSnapshot.create({
      data: {
        fromCurrency: "EUR",
        toCurrency: "KZT",
        rate: "450.50",
        source: "test-fixture",
      }
    });

    await request(app).post("/api/auth/register").send({
      email: adminEmail,
      name: "Admin User",
      password: "Admin123!",
    });
    
    // Подтверждаем email для прохождения проверки isVerified
    const admin = await prisma.user.findFirst({ where: { email: adminEmail } });
    if (admin) {
      await prisma.user.update({
        where: { id: admin.id },
        data: { isVerified: true, role: "ADMIN" }
      });
    }
    const login = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password: "Admin123!",
    });

    expect(login.status).toBe(200);
    accessToken = login.body.accessToken;

    const registryResponse = await request(app)
      .post("/api/registries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        title: "Test Wedding Registry",
        coupleName: "A & B",
        weddingDate: "2026-12-31",
        isPublic: true,
      });

    expect(registryResponse.status).toBe(201);
    registry = registryResponse.body;

    const itemResponse = await request(app)
      .post(`/api/registries/${registry.id}/items`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        title: "Kitchen set",
        description: "A gift for the couple",
        targetAmountKzt: "50000.00",
        priority: "HIGH",
      });

    expect(itemResponse.status).toBe(201);
    giftItem = itemResponse.body;
  });

  afterAll(async () => {
    if (giftItem) {
      await prisma.contribution.deleteMany({ where: { giftItemId: giftItem.id } });
      await prisma.giftItem.deleteMany({ where: { registryId: registry.id } });
    }
    if (registry) {
      await prisma.registry.deleteMany({ where: { id: registry.id } });
    }
    
    // Удаляем связанные данные в правильном порядке
    const admin = await prisma.user.findFirst({ where: { email: adminEmail } });
    if (admin) {
      await prisma.verificationToken.deleteMany({ where: { userId: admin.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: admin.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: admin.id } });
      await prisma.user.delete({ where: { id: admin.id } });
    }
    await prisma.$disconnect();
  });

  test("creates a contribution and updates gift item status", async () => {
    const response = await request(app)
      .post(`/api/items/${giftItem.id}/contributions`)
      .send({
        contributorName: "Guest Tester",
        amountKzt: 25000,
        message: "Good luck!",
      });

    expect(response.status).toBe(201);
    expect(response.body.contribution.contributorName).toBe("Guest Tester");

    const updatedItem = await prisma.giftItem.findUnique({ where: { id: giftItem.id } });
    expect(updatedItem.currentAmountKzt.toString()).toBe("25000");
    expect(updatedItem.status).toBe("PENDING");
  });

  test("rejects overfunding contributions", async () => {
    const response = await request(app)
      .post(`/api/items/${giftItem.id}/contributions`)
      .send({
        contributorName: "Guest Over",
        amountKzt: 999999999,
        message: "Too much",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("exceed target");
  });
});
