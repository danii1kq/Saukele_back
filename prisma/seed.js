require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("12345", 10);

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      passwordHash,
      role: "ADMIN",
      name: "Saukele Admin",
      isVerified: true,
    },
    create: {
      email: "admin@example.com",
      name: "Saukele Admin",
      passwordHash,
      role: "ADMIN",
      isVerified: true,
    },
  });

  const testerPasswordHash = await bcrypt.hash("Test12345", 10);

  await prisma.user.upsert({
    where: { email: "tester@example.com" },
    update: {
      passwordHash: testerPasswordHash,
      role: "REGISTRANT",
      name: "Tester One",
      isVerified: true,
    },
    create: {
      email: "tester@example.com",
      name: "Tester One",
      passwordHash: testerPasswordHash,
      role: "REGISTRANT",
      isVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "tester2@example.com" },
    update: {
      passwordHash: testerPasswordHash,
      role: "REGISTRANT",
      name: "Tester Two",
      isVerified: true,
    },
    create: {
      email: "tester2@example.com",
      name: "Tester Two",
      passwordHash: testerPasswordHash,
      role: "REGISTRANT",
      isVerified: true,
    },
  });

  await prisma.exchangeRateSnapshot.create({
    data: {
      fromCurrency: "EUR",
      toCurrency: "KZT",
      rate: 520.0,
      source: "seed",
    },
  });

  console.log("Database seeded successfully.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });