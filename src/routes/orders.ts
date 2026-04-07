import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireUser } from "../middleware/auth.js";
import { applyConsumerDeliveryRatingXp } from "../services/consumerGamification.js";

export const ordersRouter = Router();

ordersRouter.use(requireUser);

// Get the user's active order (most recent non-delivered, non-cancelled)
ordersRouter.get("/active", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const order = await prisma.order.findFirst({
      where: {
        userId,
        status: { notIn: ["DELIVERED", "CANCELLED"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        total: true,
        deliveryAddress: true,
        createdAt: true,
        estimatedPreparationMinutes: true,
        estimatedDeliveryMinutes: true,
      },
    });
    if (!order) {
      return res.status(204).send();
    }
    return res.json({
      id: order.id,
      status: order.status,
      total: Number(order.total),
      delivery_address: order.deliveryAddress,
      created_at: order.createdAt,
      estimated_preparation_minutes: order.estimatedPreparationMinutes ?? null,
      estimated_delivery_minutes: order.estimatedDeliveryMinutes ?? null,
    });
  } catch (e) {
    console.error("[GET /api/orders/active] Error:", e);
    return res.status(500).json({ error: "Failed to get active order" });
  }
});

/** POST body: { stars: number } — 1–5, una sola vez por pedido entregado. */
ordersRouter.post("/:id/rate-delivery", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const orderId = req.params.id;
    const stars = req.body?.stars != null ? Number(req.body.stars) : NaN;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "stars debe ser un entero entre 1 y 5" });
    }
    const rateResult = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
      });
      if (!order) return "not_found" as const;
      if (order.status !== "DELIVERED") return "not_delivered" as const;
      if (!order.deliveryManId) return "no_courier" as const;
      if (order.deliveryRating != null) return "already_rated" as const;
      await tx.order.update({
        where: { id: orderId },
        data: { deliveryRating: stars },
      });
      const dm = await tx.deliveryMan.findUniqueOrThrow({
        where: { id: order.deliveryManId },
      });
      const newCount = dm.ratingCount + 1;
      const newRating =
        dm.ratingCount === 0 ? stars : (dm.rating * dm.ratingCount + stars) / newCount;
      await tx.deliveryMan.update({
        where: { id: order.deliveryManId },
        data: { rating: newRating, ratingCount: newCount },
      });
      await applyConsumerDeliveryRatingXp(tx, userId, orderId, stars);
      return "ok" as const;
    });
    if (rateResult === "not_found") return res.status(404).json({ error: "Pedido no encontrado" });
    if (rateResult === "not_delivered") {
      return res.status(400).json({ error: "Solo puedes valorar pedidos entregados" });
    }
    if (rateResult === "no_courier") {
      return res.status(400).json({ error: "Este pedido no tuvo repartidor asignado" });
    }
    if (rateResult === "already_rated") {
      return res.status(400).json({ error: "Ya valoraste este reparto" });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/orders/:id/rate-delivery] Error:", e);
    return res.status(500).json({ error: "No se pudo guardar la valoración" });
  }
});

// Get order tracking details for the customer (order, delivery address coords, shop, items, delivery man)
ordersRouter.get("/:id/tracking", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const orderId = req.params.id;
    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        status: true,
        total: true,
        deliveryAddress: true,
        estimatedPreparationMinutes: true,
        estimatedDeliveryMinutes: true,
        deliveryRating: true,
        lat: true,
        lng: true,
        arrivedAtCustomerAt: true,
        createdAt: true,
        shop: { select: { name: true } },
        items: {
          select: {
            quantity: true,
            price: true,
            product: { select: { name: true } },
          },
        },
        deliveryMan: {
          select: { id: true, name: true, celphone: true, profilePhotoUrl: true, lastLat: true, lastLng: true },
        },
      },
    });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    const canRateDelivery =
      order.status === "DELIVERED" &&
      order.deliveryMan != null &&
      order.deliveryRating == null;

    return res.json({
      id: order.id,
      status: order.status,
      total: Number(order.total),
      delivery_address: order.deliveryAddress,
      estimated_preparation_minutes: order.estimatedPreparationMinutes ?? null,
      estimated_delivery_minutes: order.estimatedDeliveryMinutes ?? null,
      arrived_at_customer_at: order.arrivedAtCustomerAt ? order.arrivedAtCustomerAt.toISOString() : null,
      delivery_rating: order.deliveryRating ?? null,
      can_rate_delivery: canRateDelivery,
      lat: order.lat != null ? Number(order.lat) : null,
      lng: order.lng != null ? Number(order.lng) : null,
      created_at: order.createdAt,
      shop_name: order.shop?.name ?? null,
      items: order.items.map((i) => ({
        product_name: i.product.name,
        quantity: i.quantity,
        price: Number(i.price),
      })),
      delivery_man: order.deliveryMan
        ? {
            id: order.deliveryMan.id,
            name: order.deliveryMan.name,
            celphone: order.deliveryMan.celphone,
            profile_photo_url: order.deliveryMan.profilePhotoUrl,
            lat: order.deliveryMan.lastLat != null ? Number(order.deliveryMan.lastLat) : null,
            lng: order.deliveryMan.lastLng != null ? Number(order.deliveryMan.lastLng) : null,
          }
        : null,
    });
  } catch (e) {
    console.error("[GET /api/orders/:id/tracking] Error:", e);
    return res.status(500).json({ error: "Failed to get order tracking" });
  }
});

ordersRouter.post("/", async (req, res) => {
  try {
    const userId = (req as any).user.sub;
    const { addressId, items } = req.body || {};

    if (!addressId || typeof addressId !== "string") {
      return res.status(400).json({ error: "addressId is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required and must not be empty" });
    }

    const address = await prisma.address.findFirst({
      where: { id: addressId, userId, isActive: true },
    });
    if (!address) {
      return res.status(404).json({ error: "Address not found" });
    }

    const total = items.reduce(
      (sum: number, it: { price?: number; quantity?: number }) =>
        sum + (Number(it.price) || 0) * (Math.max(0, Number(it.quantity) || 0)),
      0
    );

    // Resolve shopId from first product (all items should be from same shop for a single order)
    const firstProductId = items[0]?.productId;
    const firstProduct = firstProductId
      ? await prisma.product.findUnique({ where: { id: firstProductId }, select: { shopId: true } })
      : null;
    const shopId = firstProduct?.shopId ?? null;

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
          shopId,
          total,
          deliveryAddress: address.address,
          lat: address.lat,
          lng: address.lng,
          status: "PENDING",
        },
      });

      for (const it of items) {
        const productId = it.productId;
        const quantity = Math.max(1, Math.floor(Number(it.quantity) || 1));
        const price = Number(it.price);
        if (!productId || Number.isNaN(price)) continue;

        const product = await tx.product.findUnique({
          where: { id: productId },
        });
        if (!product) continue;

        await tx.orderItem.create({
          data: {
            orderId: created.id,
            productId,
            quantity,
            price: price,
          },
        });
      }

      return created;
    });

    return res.status(201).json({
      id: order.id,
      total: Number(order.total),
      status: order.status,
      delivery_address: order.deliveryAddress,
      created_at: order.createdAt,
    });
  } catch (e) {
    console.error("[POST /api/orders] Error:", e);
    return res.status(500).json({ error: "Failed to create order" });
  }
});
