import { Router } from "express";
import type { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireShop } from "../middleware/auth.js";

export const shopOrdersRouter = Router();

shopOrdersRouter.use(requireShop);

/** GET /api/shop/orders - List orders for the logged-in shop (Ewe-Shop app) */
shopOrdersRouter.get("/orders", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const status = req.query.status as string | undefined;
    const where: Prisma.OrderWhereInput = { shopId };
    if (status && ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "ASSIGNED", "ON_DELIVERY", "DELIVERED", "CANCELLED"].includes(status)) {
      where.status = status as OrderStatus;
    }
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
        deliveryMan: { select: { id: true, name: true } },
      },
    }) as Array<any>;
    const userIds = [...new Set(orders.map((o) => o.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const list = orders.map((o) => {
      const user = userMap[o.userId];
      return {
        id: o.id,
        status: o.status,
        total: Number(o.total),
        deliveryAddress: o.deliveryAddress,
        createdAt: o.createdAt,
        customerName: user?.name ?? user?.email ?? null,
        customerEmail: user?.email ?? null,
        estimatedPreparationMinutes: o.estimatedPreparationMinutes ?? null,
        items: o.items.map((i: any) => ({
          productId: i.productId,
          productName: i.product?.name,
          quantity: i.quantity,
          price: Number(i.price),
        })),
        deliveryMan: o.deliveryMan,
      };
    });
    res.json(list);
  } catch (e) {
    console.error("[GET /api/shop/orders]", e);
    res.status(500).json({ error: "Error al cargar los pedidos" });
  }
});

/** PATCH /api/shop/orders/:id/accept - Shop accepts order (PENDING → CONFIRMED) */
shopOrdersRouter.patch("/orders/:id/accept", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const orderId = req.params.id;
    const order = await prisma.order.findFirst({ where: { id: orderId, shopId } });
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    if (order.status !== "PENDING") {
      return res.status(400).json({ error: "Solo se pueden aceptar pedidos pendientes" });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "CONFIRMED" },
    });
    res.json({ ok: true, status: "CONFIRMED" });
  } catch (e) {
    console.error("[PATCH /api/shop/orders/:id/accept]", e);
    res.status(500).json({ error: "Error al aceptar el pedido" });
  }
});

/** PATCH /api/shop/orders/:id/preparing - Shop marks order as preparing (CONFIRMED → PREPARING)
 * Body: { estimatedPreparationMinutes: number } — required, 1–1440 (minutes)
 */
shopOrdersRouter.patch("/orders/:id/preparing", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const orderId = req.params.id;
    const raw = (req.body as { estimatedPreparationMinutes?: unknown })?.estimatedPreparationMinutes;
    const minutes = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
      return res.status(400).json({
        error: "Se requiere estimatedPreparationMinutes entre 1 y 1440 (minutos)",
      });
    }
    const rounded = Math.round(minutes);
    const order = await prisma.order.findFirst({ where: { id: orderId, shopId } });
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    if (order.status !== "CONFIRMED") {
      return res.status(400).json({ error: "Solo se puede marcar en preparación un pedido confirmado" });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "PREPARING", estimatedPreparationMinutes: rounded },
    });
    res.json({ ok: true, status: "PREPARING", estimatedPreparationMinutes: rounded });
  } catch (e) {
    console.error("[PATCH /api/shop/orders/:id/preparing]", e);
    res.status(500).json({ error: "Error al actualizar el pedido" });
  }
});

/** PATCH /api/shop/orders/:id/ready-for-pickup - Shop marks order ready for pickup (PREPARING → READY_FOR_PICKUP) */
shopOrdersRouter.patch("/orders/:id/ready-for-pickup", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const orderId = req.params.id;
    const order = await prisma.order.findFirst({ where: { id: orderId, shopId } });
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    if (order.status !== "PREPARING") {
      return res.status(400).json({ error: "Solo se puede marcar listo para recoger un pedido en preparación" });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "READY_FOR_PICKUP" },
    });
    res.json({ ok: true, status: "READY_FOR_PICKUP" });
  } catch (e) {
    console.error("[PATCH /api/shop/orders/:id/ready-for-pickup]", e);
    res.status(500).json({ error: "Error al actualizar el pedido" });
  }
});

/** PATCH /api/shop/orders/:id/reject - Shop rejects order (PENDING → CANCELLED) */
shopOrdersRouter.patch("/orders/:id/reject", async (req, res) => {
  try {
    const shopId = (req as typeof req & { shopId: string }).shopId;
    const orderId = req.params.id;
    const order = await prisma.order.findFirst({ where: { id: orderId, shopId } });
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    if (order.status !== "PENDING") {
      return res.status(400).json({ error: "Solo se pueden rechazar pedidos pendientes" });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });
    res.json({ ok: true, status: "CANCELLED" });
  } catch (e) {
    console.error("[PATCH /api/shop/orders/:id/reject]", e);
    res.status(500).json({ error: "Error al rechazar el pedido" });
  }
});
