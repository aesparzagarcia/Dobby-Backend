import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hash = bcrypt.hashSync("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@ewe.local" },
    update: { passwordHash: hash, role: "ADMIN" },
    create: {
      email: "admin@ewe.local",
      passwordHash: hash,
      role: "ADMIN",
    },
  });
  console.log("Admin user:", admin.email, "(password: admin123)");

  const existingShop = await prisma.shop.findFirst();
  if (!existingShop) {
    await prisma.shop.createMany({
      data: [
        { name: "Sample Restaurant", type: "RESTAURANT", address: "123 Main St", phone: "+1234567890", status: "ACTIVE" },
        { name: "Corner Store", type: "SHOP", address: "456 Oak Ave", phone: "+0987654321", status: "ACTIVE" },
      ],
    });
    console.log("Shops created");
  }

  const existingService = await prisma.service.findFirst();
  if (!existingService) {
    await prisma.service.createMany({
      data: [
        { name: "Pay light bill", description: "Electricity bill payment", category: "LIGHT", isActive: true },
        { name: "Pay gas bill", category: "GAS", isActive: true },
        { name: "Phone top-up", category: "PHONE", isActive: true },
      ],
    });
    console.log("Services created");
  }

  const driverUser = await prisma.user.upsert({
    where: { email: "driver@ewe.local" },
    update: {},
    create: {
      email: "driver@ewe.local",
      passwordHash: bcrypt.hashSync("driver123", 12),
      role: "DELIVERY",
    },
  });
  await prisma.deliveryMan.upsert({
    where: { userId: driverUser.id },
    update: {},
    create: {
      userId: driverUser.id,
      status: "OFFLINE",
    },
  });
  console.log("Delivery user:", driverUser.email);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
