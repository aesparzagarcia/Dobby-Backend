import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";
import { hashPassword } from "../lib/auth.js";

export const deliveryMenRouter = Router();

deliveryMenRouter.use(requireAdmin);

deliveryMenRouter.get("/", async (req, res) => {
  const list = await prisma.deliveryMan.findMany({
    include: { user: { select: { id: true, email: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
  res.json(list);
});

deliveryMenRouter.post("/", async (req, res) => {
  const body = req.body || {};
  const {
    email,
    password,
    name,
    last_name,
    profilePhotoUrl,
    address,
    celphone,
    phone,
    idImageFrontUrl,
    idImageBackUrl,
    referenceName,
    referencePhone,
    referenceAddress,
  } = body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Se requieren correo, contraseña y nombre" });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return res.status(400).json({ error: "Ya existe un usuario con ese correo" });
  }

  const passwordHash = await hashPassword(password);
  const userPhone = (phone ?? celphone) != null ? String(phone ?? celphone).trim() : null;
  const newUser = await prisma.user.create({
    data: {
      email: String(email).trim(),
      passwordHash,
      role: "DELIVERY",
      name: String(name).trim(),
      lastName: last_name != null ? String(last_name).trim() : null,
      phone: userPhone || undefined,
    },
  });

  await prisma.deliveryMan.create({
    data: {
      userId: newUser.id,
      name: name.trim(),
      profilePhotoUrl: profilePhotoUrl || null,
      address: address?.trim() || null,
      celphone: celphone?.trim() || null,
      idImageFrontUrl: idImageFrontUrl || null,
      idImageBackUrl: idImageBackUrl || null,
      referenceName: referenceName?.trim() || null,
      referencePhone: referencePhone?.trim() || null,
      referenceAddress: referenceAddress?.trim() || null,
    },
  });

  const list = await prisma.deliveryMan.findMany({
    include: { user: { select: { id: true, email: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
  res.json(list);
});

deliveryMenRouter.get("/:id", async (req, res) => {
  const d = await prisma.deliveryMan.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!d) return res.status(404).json({ error: "No encontrado" });
  res.json(d);
});

deliveryMenRouter.put("/:id", async (req, res) => {
  const existing = await prisma.deliveryMan.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "No encontrado" });

  const body = req.body || {};
  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = String(body.name).trim();
  if (body.profilePhotoUrl !== undefined) data.profilePhotoUrl = body.profilePhotoUrl || null;
  if (body.address !== undefined) data.address = body.address?.trim() || null;
  if (body.celphone !== undefined) data.celphone = body.celphone?.trim() || null;
  if (body.idImageFrontUrl !== undefined) data.idImageFrontUrl = body.idImageFrontUrl || null;
  if (body.idImageBackUrl !== undefined) data.idImageBackUrl = body.idImageBackUrl || null;
  if (body.referenceName !== undefined) data.referenceName = body.referenceName?.trim() || null;
  if (body.referencePhone !== undefined) data.referencePhone = body.referencePhone?.trim() || null;
  if (body.referenceAddress !== undefined) data.referenceAddress = body.referenceAddress?.trim() || null;
  if (body.status && ["OFFLINE", "ONLINE", "ON_DELIVERY"].includes(body.status)) {
    data.status = body.status;
    data.lastSeenAt = new Date();
  }

  const updated = await prisma.deliveryMan.update({
    where: { id: req.params.id },
    data: data as any,
    include: { user: { select: { id: true, email: true } } },
  });
  res.json(updated);
});

deliveryMenRouter.patch("/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!status || !["OFFLINE", "ONLINE", "ON_DELIVERY"].includes(status)) {
    return res.status(400).json({ error: "Estado inválido" });
  }
  const d = await prisma.deliveryMan.update({
    where: { id: req.params.id },
    data: { status: status as "OFFLINE" | "ONLINE" | "ON_DELIVERY", lastSeenAt: new Date() },
  }).catch(() => null);
  if (!d) return res.status(404).json({ error: "No encontrado" });
  res.json(d);
});
