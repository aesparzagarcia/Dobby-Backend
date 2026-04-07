import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireUser } from "../middleware/auth.js";
import { getConsumerGamificationSnapshot } from "../services/consumerGamification.js";

/**
 * Public API for the mobile app (no admin auth required).
 */
export const appRouter = Router();

/** Consumer (Dobby app): nivel, XP, racha — requiere Bearer de usuario USER. */
appRouter.get("/me/gamification", requireUser, async (req, res) => {
  try {
    const user = (req as unknown as { user: { sub: string; role: string } }).user;
    if (user.role !== "USER") {
      return res.status(403).json({ error: "Only for consumer accounts" });
    }
    const snap = await getConsumerGamificationSnapshot(prisma, user.sub);
    return res.json(snap);
  } catch (e) {
    console.error("[GET /api/app/me/gamification]", e);
    return res.status(500).json({ error: "Failed to load gamification" });
  }
});

appRouter.get("/places", async (_req, res) => {
  try {
    const [shops, services] = await Promise.all([
      prisma.shop.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, logoUrl: true, type: true, rate: true },
      }),
      prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, logoUrl: true, category: true, rate: true },
      }),
    ]);
    res.json({ shops, services });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load places" });
  }
});

/**
 * Home screen: featured places (shops + services) and best-seller products.
 */
appRouter.get("/home", async (_req, res) => {
  try {
    const [shops, services, products] = await Promise.all([
      prisma.shop.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, logoUrl: true, type: true, rate: true },
      }),
      prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, logoUrl: true, category: true, rate: true },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, name: true, imageUrls: true, price: true, rate: true, hasPromotion: true, discount: true },
      }),
    ]);
    const featuredPlaces = [
      ...shops.map((s) => ({ ...s, kind: "shop" as const })),
      ...services.map((s) => ({ ...s, kind: "service" as const })),
    ];
    const bestSellerProducts = products.map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: Array.isArray(p.imageUrls) && p.imageUrls.length > 0 ? p.imageUrls[0] : null,
      price: Number(p.price),
      rate: p.rate,
      has_promotion: p.hasPromotion,
      discount: p.discount,
    }));
    res.json({ featuredPlaces, bestSellerProducts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load home" });
  }
});

appRouter.get("/shops/:id/products", async (req, res) => {
  try {
    const shopId = req.params.id;
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, price: true, imageUrls: true, rate: true, hasPromotion: true, discount: true },
    });
    res.json(products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      imageUrl: Array.isArray(p.imageUrls) && p.imageUrls.length > 0 ? p.imageUrls[0] : null,
      rate: p.rate,
      has_promotion: p.hasPromotion,
      discount: p.discount,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load products" });
  }
});

appRouter.get("/products/:id", async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, isActive: true },
      select: { id: true, name: true, description: true, price: true, imageUrls: true, rate: true, hasPromotion: true, discount: true },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({
      id: product.id,
      name: product.name,
      rate: product.rate,
      description: product.description ?? "",
      price: Number(product.price),
      imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
      has_promotion: product.hasPromotion,
      discount: product.discount,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load product" });
  }
});

appRouter.get("/promotions", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true, hasPromotion: true },
      orderBy: [{ discount: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        name: true,
        imageUrls: true,
        price: true,
        rate: true,
        hasPromotion: true,
        discount: true,
      },
    });
    res.json(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: Array.isArray(p.imageUrls) && p.imageUrls.length > 0 ? p.imageUrls[0] : null,
        price: Number(p.price),
        rate: p.rate,
        has_promotion: p.hasPromotion,
        discount: p.discount,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load promotions" });
  }
});

appRouter.get("/services/:id", async (req, res) => {
  try {
    const service = await prisma.service.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, description: true, logoUrl: true, category: true, rate: true },
    });
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json(service);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load service" });
  }
});

appRouter.get("/ads", async (_req, res) => {
  try {
    const ads = await prisma.ad.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        imageUrl: true,
        advertiserName: true,
        description: true,
        address: true,
        contactPhone: true,
        whatsapp: true,
      },
    });
    res.json(ads);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load ads" });
  }
});

appRouter.get("/ads/:id", async (req, res) => {
  try {
    const ad = await prisma.ad.findUnique({
      where: { id: req.params.id },
    });
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    res.json({
      id: ad.id,
      imageUrl: ad.imageUrl,
      advertiserName: ad.advertiserName,
      description: ad.description,
      address: ad.address,
      contactPhone: ad.contactPhone,
      whatsapp: ad.whatsapp,
      email: ad.email,
      facebookUrl: ad.facebookUrl,
      instagramUrl: ad.instagramUrl,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load ad" });
  }
});
