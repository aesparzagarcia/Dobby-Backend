import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAdmin);

analyticsRouter.get("/income", async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (from) where.createdAt = { ...where.createdAt, gte: new Date(from) };
  if (to) where.createdAt = { ...where.createdAt, lte: new Date(to) };
  const orders = await prisma.order.findMany({
    where: Object.keys(where).length ? where : undefined,
    select: { total: true, createdAt: true },
  });
  const total = orders.reduce((sum, o) => sum + Number(o.total), 0);
  const byDay: Record<string, number> = {};
  for (const o of orders) {
    const day = o.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Number(o.total);
  }
  res.json({ total, byDay });
});

analyticsRouter.get("/best-shops", async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const where: { createdAt?: { gte?: Date; lte?: Date }; shopId?: { not: null } } = { shopId: { not: null } };
  if (from) where.createdAt = { ...where.createdAt, gte: new Date(from) };
  if (to) where.createdAt = { ...where.createdAt, lte: new Date(to) };
  const orders = await prisma.order.findMany({
    where: { ...where, shopId: { not: null } },
    select: { shopId: true, total: true },
  });
  const byShop: Record<string, { revenue: number; count: number }> = {};
  for (const o of orders) {
    if (!o.shopId) continue;
    if (!byShop[o.shopId]) byShop[o.shopId] = { revenue: 0, count: 0 };
    byShop[o.shopId].revenue += Number(o.total);
    byShop[o.shopId].count += 1;
  }
  const shopIds = Object.keys(byShop);
  const shops = await prisma.shop.findMany({
    where: { id: { in: shopIds } },
    select: { id: true, name: true },
  });
  const shopMap = Object.fromEntries(shops.map((s) => [s.id, s.name]));
  const list = Object.entries(byShop)
    .map(([shopId, data]) => ({
      shopId,
      shopName: shopMap[shopId] || "Unknown",
      revenue: data.revenue,
      orderCount: data.count,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
  res.json(list);
});

analyticsRouter.get("/best-products", async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const where: { order: { createdAt?: { gte?: Date; lte?: Date } } } = { order: {} };
  if (from) where.order.createdAt = { ...where.order.createdAt, gte: new Date(from) };
  if (to) where.order.createdAt = { ...where.order.createdAt, lte: new Date(to) };
  const items = await prisma.orderItem.findMany({
    where,
    select: { productId: true, quantity: true, price: true },
  });
  const byProduct: Record<string, { quantity: number; revenue: number }> = {};
  for (const i of items) {
    if (!byProduct[i.productId]) byProduct[i.productId] = { quantity: 0, revenue: 0 };
    byProduct[i.productId].quantity += i.quantity;
    byProduct[i.productId].revenue += i.quantity * Number(i.price);
  }
  const productIds = Object.keys(byProduct);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, shop: { select: { name: true } } },
  });
  const productMap = Object.fromEntries(
    products.map((p) => [p.id, { name: p.name, shopName: p.shop.name }])
  );
  const list = Object.entries(byProduct)
    .map(([productId, data]) => ({
      productId,
      productName: productMap[productId]?.name || "Unknown",
      shopName: productMap[productId]?.shopName || "Unknown",
      quantitySold: data.quantity,
      revenue: data.revenue,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
  res.json(list);
});

analyticsRouter.get("/most-requested-services", async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (from) where.createdAt = { ...where.createdAt, gte: new Date(from) };
  if (to) where.createdAt = { ...where.createdAt, lte: new Date(to) };
  const requests = await prisma.serviceRequest.findMany({
    where,
    select: { serviceId: true },
  });
  const byService: Record<string, number> = {};
  for (const r of requests) {
    byService[r.serviceId] = (byService[r.serviceId] || 0) + 1;
  }
  const serviceIds = Object.keys(byService);
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true, category: true },
  });
  const serviceMap = Object.fromEntries(
    services.map((s) => [s.id, { name: s.name, category: s.category }])
  );
  const list = Object.entries(byService)
    .map(([serviceId, count]) => ({
      serviceId,
      serviceName: serviceMap[serviceId]?.name || "Unknown",
      category: serviceMap[serviceId]?.category || "OTHER",
      requestCount: count,
    }))
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, limit);
  res.json(list);
});
