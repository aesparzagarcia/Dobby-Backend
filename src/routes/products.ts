import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";

export const productsRouter = Router();

productsRouter.use(requireAdmin);

productsRouter.get("/", async (req, res) => {
  const shopId = req.query.shopId as string | undefined;
  const products = await prisma.product.findMany({
    where: shopId ? { shopId } : undefined,
    include: { shop: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(products);
});

productsRouter.post("/", async (req, res) => {
  const { shopId, name, description, price, imageUrls, isActive, hasPromotion, discount } = req.body || {};
  if (!shopId || !name || price == null) {
    return res.status(400).json({ error: "Se requieren tienda, nombre y precio" });
  }
  const normalizedDiscount = discount == null ? 0 : Number(discount);
  if (!Number.isInteger(normalizedDiscount) || normalizedDiscount < 0 || normalizedDiscount > 100) {
    return res.status(400).json({ error: "discount debe ser un entero entre 0 y 100" });
  }
  const product = await prisma.product.create({
    data: {
      shopId,
      name,
      description: description || null,
      price: Number(price),
      imageUrls: Array.isArray(imageUrls) ? imageUrls.slice(0, 3) : [],
      hasPromotion: hasPromotion === true,
      discount: normalizedDiscount,
      isActive: isActive !== false,
    },
  });
  res.json(product);
});

productsRouter.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { shop: true },
  });
  if (!product) return res.status(404).json({ error: "No encontrado" });
  res.json(product);
});

productsRouter.put("/:id", async (req, res) => {
  const body = req.body || {};
  const updates: Record<string, unknown> = {
    ...(body.shopId != null && { shopId: body.shopId }),
    ...(body.name != null && { name: body.name }),
    ...(body.description != null && { description: body.description }),
    ...(body.price != null && { price: body.price }),
    ...(body.imageUrls !== undefined && { imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.slice(0, 3) : [] }),
    ...(body.isActive != null && { isActive: body.isActive }),
    ...(body.hasPromotion != null && { hasPromotion: body.hasPromotion }),
  };
  if (body.discount != null) {
    const normalizedDiscount = Number(body.discount);
    if (!Number.isInteger(normalizedDiscount) || normalizedDiscount < 0 || normalizedDiscount > 100) {
      return res.status(400).json({ error: "discount debe ser un entero entre 0 y 100" });
    }
    updates.discount = normalizedDiscount;
  }
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: updates,
  }).catch(() => null);
  if (!product) return res.status(404).json({ error: "No encontrado" });
  res.json(product);
});

productsRouter.delete("/:id", async (req, res) => {
  await prisma.product.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});
