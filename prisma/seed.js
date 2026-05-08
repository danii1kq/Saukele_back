require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Admin123!", 10);

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      passwordHash,
      role: "ADMIN",
      name: "Saukele Admin",
    },
    create: {
      email: "admin@example.com",
      name: "Saukele Admin",
      passwordHash,
      role: "ADMIN",
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
