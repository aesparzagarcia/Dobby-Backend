import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireShop } from "../middleware/auth.js";

export const shopProductsRouter = Router();

shopProductsRouter.use(requireShop);

type ProductWithShop = Prisma.ProductGetPayload<{ include: { shop: { select: { name: true } } } }>;

function jsonProduct(p: ProductWithShop) {
  return {
    ...p,
    price: Number(p.price),
  };
}

/** GET /api/shop/products — productos de la tienda en sesión (JWT sub = shopId). */
shopProductsRouter.get("/products", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const products = await prisma.product.findMany({
      where: { shopId },
      include: { shop: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(products.map((p) => jsonProduct(p)));
  } catch (e) {
    console.error("[GET /api/shop/products]", e);
    res.status(500).json({ error: "Error al cargar productos" });
  }
});

/** POST /api/shop/products — crea producto solo para esta tienda (no se envía shopId en el body). */
shopProductsRouter.post("/products", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const { name, description, price, imageUrls, isActive, hasPromotion, discount } = req.body || {};
    if (!name || price == null) {
      return res.status(400).json({ error: "Se requieren nombre y precio" });
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
      include: { shop: { select: { name: true } } },
    });
    res.json(jsonProduct(product));
  } catch (e) {
    console.error("[POST /api/shop/products]", e);
    res.status(500).json({ error: "Error al crear producto" });
  }
});

/** PUT /api/shop/products/:id — solo si el producto pertenece a esta tienda. */
shopProductsRouter.put("/products/:id", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const id = req.params.id;
    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    const body = req.body || {};
    const updates: Record<string, unknown> = {
      ...(body.name != null && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
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
      where: { id },
      data: updates as Prisma.ProductUpdateInput,
      include: { shop: { select: { name: true } } },
    });
    res.json(jsonProduct(product));
  } catch (e) {
    console.error("[PUT /api/shop/products/:id]", e);
    res.status(500).json({ error: "Error al actualizar producto" });
  }
});

/** DELETE /api/shop/products/:id */
shopProductsRouter.delete("/products/:id", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const id = req.params.id;
    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    await prisma.product.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/shop/products/:id]", e);
    res.status(500).json({ error: "Error al eliminar producto" });
  }
});
