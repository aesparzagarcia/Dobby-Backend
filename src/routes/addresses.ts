import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireUser } from "../middleware/auth.js";

export const addressesRouter = Router();

addressesRouter.use(requireUser);

addressesRouter.get("/", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const addresses = await prisma.address.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return res.json(
      addresses.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description ?? "",
        address: a.address,
        lat: a.lat,
        lng: a.lng,
        is_default: a.isDefault,
        is_active: a.isActive,
        created_at: a.createdAt,
      }))
    );
  } catch (e) {
    const err = e as Error;
    console.error("[GET /api/addresses] Error:", err.message, err.stack);
    return res.status(500).json({
      error: "Failed to list addresses",
      details: process.env.NODE_ENV !== "production" ? err.message : undefined,
    });
  }
});

addressesRouter.post("/", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    console.log("[POST /api/addresses] Creating address for userId:", userId);
    const { label, description, address, lat, lng, is_default } = req.body || {};
    const labelStr = typeof label === "string" ? label.trim() || "Home" : "Home";
    const descriptionStr = typeof description === "string" ? description.trim() || null : null;
    const addressStr = typeof address === "string" ? address.trim() : "";
    const latNum = typeof lat === "number" ? lat : Number(lat);
    const lngNum = typeof lng === "number" ? lng : Number(lng);
    if (!addressStr || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ error: "address, lat and lng are required" });
    }
    const isDefault = !!is_default;
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId, isActive: true },
        data: { isDefault: false },
      });
    }
    const created = await prisma.address.create({
      data: {
        userId,
        label: labelStr,
        description: descriptionStr,
        address: addressStr,
        lat: latNum,
        lng: lngNum,
        isDefault,
      },
    });
    console.log("[POST /api/addresses] Created address id:", created.id);
    return res.status(201).json({
      id: created.id,
      label: created.label,
      description: created.description ?? "",
      address: created.address,
      lat: created.lat,
      lng: created.lng,
      is_default: created.isDefault,
      is_active: created.isActive,
      created_at: created.createdAt,
    });
  } catch (e) {
    console.error("[POST /api/addresses] Error:", e);
    return res.status(500).json({ error: "Failed to create address" });
  }
});

// Set address as default (and clear default on others)
addressesRouter.patch("/:id/default", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "Address id is required" });
    }
    const address = await prisma.address.findFirst({
      where: { id, userId, isActive: true },
    });
    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }
    await prisma.address.updateMany({
      where: { userId, isActive: true },
      data: { isDefault: false },
    });
    await prisma.address.update({
      where: { id },
      data: { isDefault: true },
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[PATCH /api/addresses/:id/default] Error:", e);
    return res.status(500).json({ error: "Failed to set default address" });
  }
});

// Soft delete: set is_active to false
addressesRouter.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "Address id is required" });
    }
    const address = await prisma.address.findFirst({
      where: { id, userId },
    });
    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }
    await prisma.address.update({
      where: { id },
      data: { isActive: false },
    });
    return res.status(204).send();
  } catch (e) {
    console.error("[DELETE /api/addresses/:id] Error:", e);
    return res.status(500).json({ error: "Failed to delete address" });
  }
});
