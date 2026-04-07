import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";

export const adsRouter = Router();

adsRouter.use(requireAdmin);

adsRouter.get("/", async (_req, res) => {
  const ads = await prisma.ad.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(ads);
});

adsRouter.post("/", async (req, res) => {
  const body = req.body || {};
  const {
    imageUrl,
    advertiserName,
    description,
    address,
    contactPhone,
    whatsapp,
    facebookUrl,
    instagramUrl,
    email,
    isActive,
  } = body;
  if (!advertiserName?.trim()) {
    return res.status(400).json({ error: "Se requiere el nombre del anunciante" });
  }
  const ad = await prisma.ad.create({
    data: {
      imageUrl: imageUrl || null,
      advertiserName: advertiserName.trim(),
      description: description?.trim() || null,
      address: address?.trim() || null,
      contactPhone: contactPhone?.trim() || null,
      whatsapp: whatsapp?.trim() || null,
      facebookUrl: facebookUrl?.trim() || null,
      instagramUrl: instagramUrl?.trim() || null,
      email: email?.trim() || null,
      isActive: isActive !== false,
    },
  });
  res.json(ad);
});

adsRouter.get("/:id", async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!ad) return res.status(404).json({ error: "No encontrado" });
  res.json(ad);
});

adsRouter.put("/:id", async (req, res) => {
  const existing = await prisma.ad.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "No encontrado" });
  const body = req.body || {};
  const ad = await prisma.ad.update({
    where: { id: req.params.id },
    data: {
      ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl || null }),
      ...(body.advertiserName != null && { advertiserName: String(body.advertiserName).trim() }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(body.address !== undefined && { address: body.address?.trim() || null }),
      ...(body.contactPhone !== undefined && { contactPhone: body.contactPhone?.trim() || null }),
      ...(body.whatsapp !== undefined && { whatsapp: body.whatsapp?.trim() || null }),
      ...(body.facebookUrl !== undefined && { facebookUrl: body.facebookUrl?.trim() || null }),
      ...(body.instagramUrl !== undefined && { instagramUrl: body.instagramUrl?.trim() || null }),
      ...(body.email !== undefined && { email: body.email?.trim() || null }),
      ...(body.isActive !== undefined && { isActive: !!body.isActive }),
    },
  });
  res.json(ad);
});

adsRouter.delete("/:id", async (req, res) => {
  await prisma.ad.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});
