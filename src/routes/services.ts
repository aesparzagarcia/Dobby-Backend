import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";

export const servicesRouter = Router();

servicesRouter.use(requireAdmin);

servicesRouter.get("/", async (req, res) => {
  const category = req.query.category as string | undefined;
  const isActive = req.query.isActive;
  const where: { category?: "LIGHT" | "GAS" | "PHONE" | "WATER" | "OTHER"; isActive?: boolean } = {};
  if (category && ["LIGHT", "GAS", "PHONE", "WATER", "OTHER"].includes(category)) where.category = category as any;
  if (isActive !== undefined && isActive !== "") where.isActive = isActive === "true";
  const services = await prisma.service.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(services);
});

servicesRouter.post("/", async (req, res) => {
  const { name, description, category, logoUrl, isActive } = req.body || {};
  if (!name) return res.status(400).json({ error: "Se requiere nombre" });
  const service = await prisma.service.create({
    data: {
      name,
      description: description || null,
      category: (category as "LIGHT" | "GAS" | "PHONE" | "WATER" | "OTHER") || "OTHER",
      logoUrl: logoUrl || null,
      isActive: isActive !== false,
    },
  });
  res.json(service);
});

servicesRouter.get("/:id", async (req, res) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service) return res.status(404).json({ error: "No encontrado" });
  res.json(service);
});

servicesRouter.put("/:id", async (req, res) => {
  const body = req.body || {};
  const service = await prisma.service.update({
    where: { id: req.params.id },
    data: {
      ...(body.name != null && { name: body.name }),
      ...(body.description != null && { description: body.description }),
      ...(body.category != null && { category: body.category }),
      ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl || null }),
      ...(body.isActive != null && { isActive: body.isActive }),
    },
  }).catch(() => null);
  if (!service) return res.status(404).json({ error: "No encontrado" });
  res.json(service);
});

servicesRouter.delete("/:id", async (req, res) => {
  await prisma.service.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});
