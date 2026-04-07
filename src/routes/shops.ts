import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";

export const shopsRouter = Router();

shopsRouter.use(requireAdmin);

shopsRouter.get("/", async (req, res) => {
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const where: { type?: "RESTAURANT" | "SHOP" | "SERVICE_PROVIDER"; status?: "ACTIVE" | "INACTIVE" } = {};
  if (type && ["RESTAURANT", "SHOP", "SERVICE_PROVIDER"].includes(type)) where.type = type as any;
  if (status && ["ACTIVE", "INACTIVE"].includes(status)) where.status = status as any;
  const shops = await prisma.shop.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(shops);
});

shopsRouter.post("/", async (req, res) => {
  const { name, type, address, phone, logoUrl, status } = req.body || {};
  if (!name || !type || !address) {
    return res.status(400).json({ error: "Se requieren nombre, tipo y dirección" });
  }
  const shop = await prisma.shop.create({
    data: {
      name,
      type: type as "RESTAURANT" | "SHOP" | "SERVICE_PROVIDER",
      address,
      phone: phone || null,
      logoUrl: logoUrl || null,
      status: (status as "ACTIVE" | "INACTIVE") || "ACTIVE",
    },
  });
  res.json(shop);
});

shopsRouter.get("/:id", async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { id: req.params.id } });
  if (!shop) return res.status(404).json({ error: "No encontrado" });
  res.json(shop);
});

shopsRouter.put("/:id", async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { id: req.params.id } });
  if (!shop) return res.status(404).json({ error: "No encontrado" });
  const body = req.body || {};
  const updated = await prisma.shop.update({
    where: { id: req.params.id },
    data: {
      ...(body.name != null && { name: body.name }),
      ...(body.type != null && { type: body.type }),
      ...(body.address != null && { address: body.address }),
      ...(body.phone != null && { phone: body.phone }),
      ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl || null }),
      ...(body.status != null && { status: body.status }),
    },
  });
  res.json(updated);
});

shopsRouter.delete("/:id", async (req, res) => {
  await prisma.shop.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});
