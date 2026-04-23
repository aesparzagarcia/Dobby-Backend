import { prisma } from "../lib/db.js";
import { geocodeAddressNominatim } from "../lib/geocodeNominatim.js";
import { requireDelivery } from "../middleware/auth.js";
import { Router } from "express";
import {
  computeStreakUpdate,
  getMissionsForDeliveryMan,
  levelInfoFromXp,
  xpForDelivery,
} from "../services/deliveryGamification.js";
import { applyConsumerOrderDelivered } from "../services/consumerGamification.js";
import { notifyConsumerOrderStatusIfConfigured } from "../services/pushNotifications.js";

export const deliveryOrdersRouter = Router();

deliveryOrdersRouter.use(requireDelivery);

const ACTIVE_ORDER_STATUSES = ["ASSIGNED", "ON_DELIVERY"] as const;

/**
 * PATCH /api/delivery/status - El repartidor indica si está conectado (ONLINE) o desconectado (OFFLINE).
 * ON_DELIVERY solo lo asigna el servidor al iniciar ruta.
 * No se puede pasar a OFFLINE si hay un pedido ASSIGNED u ON_DELIVERY activo.
 */
deliveryOrdersRouter.patch("/status", async (req, res) => {
  try {
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const raw = req.body?.status;
    if (raw !== "OFFLINE" && raw !== "ONLINE") {
      return res.status(400).json({
        error: "status debe ser OFFLINE u ONLINE (usa el endpoint de inicio de ruta para en reparto)",
      });
    }
    if (raw === "OFFLINE") {
      const pending = await prisma.order.count({
        where: {
          deliveryManId,
          status: { in: [...ACTIVE_ORDER_STATUSES] },
        },
      });
      if (pending > 0) {
        return res.status(400).json({
          error: "Tienes pedidos asignados o en ruta; termínalos o desasígnalos antes de desconectarte",
        });
      }
    }
    await prisma.deliveryMan.update({
      where: { id: deliveryManId },
      data: { status: raw, lastSeenAt: new Date() },
    });
    res.json({ ok: true, status: raw });
  } catch (e) {
    console.error("[PATCH /api/delivery/status]", e);
    res.status(500).json({ error: "Error al actualizar estado" });
  }
});

/**
 * GET /api/delivery/profile - Gamificación: XP, nivel, rating, racha, misiones.
 */
deliveryOrdersRouter.get("/profile", async (req, res) => {
  try {
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const dm = await prisma.deliveryMan.findUnique({
      where: { id: deliveryManId },
      select: {
        name: true,
        profilePhotoUrl: true,
        status: true,
        xp: true,
        rating: true,
        ratingCount: true,
        totalDeliveries: true,
        currentStreakDays: true,
      },
    });
    if (!dm) {
      return res.status(404).json({ error: "Repartidor no encontrado" });
    }
    const level = levelInfoFromXp(dm.xp);
    const missions = await getMissionsForDeliveryMan(prisma, deliveryManId);
    res.json({
      name: dm.name,
      profile_photo_url: dm.profilePhotoUrl,
      status: dm.status,
      level_key: level.levelKey,
      xp: dm.xp,
      xp_at_current_level: level.xpAtLevelStart,
      xp_for_next_level: level.xpForNextLevel,
      rating: dm.rating,
      rating_count: dm.ratingCount,
      current_streak_days: dm.currentStreakDays,
      total_deliveries: dm.totalDeliveries,
      missions,
    });
  } catch (e) {
    console.error("[GET /api/delivery/profile]", e);
    res.status(500).json({ error: "Error al cargar el perfil" });
  }
});

/**
 * PATCH /api/delivery/location - Update this delivery man's last known position (for customer tracking).
 * Body: { lat: number, lng: number }
 */
deliveryOrdersRouter.patch("/location", async (req, res) => {
  try {
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const lat = req.body?.lat != null ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null ? Number(req.body.lng) : null;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }
    await prisma.deliveryMan.update({
      where: { id: deliveryManId },
      data: { lastLat: lat, lastLng: lng, lastSeenAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("[PATCH /api/delivery/location]", e);
    res.status(500).json({ error: "Error al actualizar ubicación" });
  }
});

/**
 * PATCH /api/delivery/orders/:id/delivery-eta - Store driving ETA (minutes) for customer tracking while ON_DELIVERY.
 * Body: { estimatedDeliveryMinutes: number } — integer 1..1440
 */
deliveryOrdersRouter.patch("/orders/:id/delivery-eta", async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const raw = req.body?.estimatedDeliveryMinutes;
    const minutes = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : NaN;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
      return res.status(400).json({ error: "estimatedDeliveryMinutes must be a whole number from 1 to 1440" });
    }
    const order = await prisma.order.findFirst({
      where: { id: orderId, deliveryManId, status: "ON_DELIVERY" },
    });
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado o no en ruta" });
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { estimatedDeliveryMinutes: minutes },
    });
    res.json({ ok: true, estimatedDeliveryMinutes: minutes });
  } catch (e) {
    console.error("[PATCH /api/delivery/orders/:id/delivery-eta]", e);
    res.status(500).json({ error: "Error al actualizar tiempo de entrega" });
  }
});

/**
 * GET /api/delivery/orders - List orders ready for pickup (and optionally assigned to this delivery person).
 * Query: status = READY_FOR_PICKUP (default) | ASSIGNED | ON_DELIVERY | DELIVERED
 */
deliveryOrdersRouter.get("/orders", async (req, res) => {
  try {
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const status = req.query.status as string | undefined;
    const validStatuses = ["READY_FOR_PICKUP", "ASSIGNED", "ON_DELIVERY", "DELIVERED"] as const;
    const statusFilter = status && validStatuses.includes(status as (typeof validStatuses)[number])
      ? (status as (typeof validStatuses)[number])
      : "READY_FOR_PICKUP";

    const where =
      statusFilter === "READY_FOR_PICKUP"
        ? { status: "READY_FOR_PICKUP" as const }
        : { status: statusFilter, deliveryManId };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        shop: { select: { id: true, name: true, lat: true, lng: true } },
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

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
        estimatedPreparationMinutes: o.estimatedPreparationMinutes ?? null,
        estimatedDeliveryMinutes: o.estimatedDeliveryMinutes ?? null,
        arrivedAtCustomerAt: o.arrivedAtCustomerAt ? o.arrivedAtCustomerAt.toISOString() : null,
        createdAt: o.createdAt,
        shopName: o.shop?.name ?? null,
        shopLat: o.shop?.lat != null ? Number(o.shop.lat) : null,
        shopLng: o.shop?.lng != null ? Number(o.shop.lng) : null,
        customerName: user?.name ?? user?.email ?? null,
        items: o.items.map((i) => ({
          productId: i.productId,
          productName: i.product?.name ?? null,
          quantity: i.quantity,
          price: Number(i.price),
        })),
      };
    });

    res.json(list);
  } catch (e) {
    console.error("[GET /api/delivery/orders]", e);
    res.status(500).json({ error: "Error al cargar los pedidos" });
  }
});

/**
 * GET /api/delivery/orders/:id - Get single order details (must be READY_FOR_PICKUP or assigned to this delivery person).
 */
deliveryOrdersRouter.get("/orders/:id", async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [
          { status: "READY_FOR_PICKUP" },
          { status: "ASSIGNED", deliveryManId },
          { status: "ON_DELIVERY", deliveryManId },
          { status: "DELIVERED", deliveryManId },
        ],
      },
      include: {
        shop: { select: { id: true, name: true, address: true, lat: true, lng: true } },
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    const [user] = await prisma.user.findMany({
      where: { id: order.userId },
      select: { id: true, name: true, email: true },
    });

    let shopLat = order.shop?.lat != null ? Number(order.shop.lat) : null;
    let shopLng = order.shop?.lng != null ? Number(order.shop.lng) : null;
    if (shopLat == null && shopLng == null && order.shop?.address && order.shop.id) {
      const coords = await geocodeAddressNominatim(order.shop.address, `shop:${order.shop.id}`);
      if (coords) {
        shopLat = coords.lat;
        shopLng = coords.lng;
      }
    }

    res.json({
      id: order.id,
      status: order.status,
      total: Number(order.total),
      deliveryAddress: order.deliveryAddress,
      estimatedPreparationMinutes: order.estimatedPreparationMinutes ?? null,
      estimatedDeliveryMinutes: order.estimatedDeliveryMinutes ?? null,
      arrivedAtCustomerAt: order.arrivedAtCustomerAt ? order.arrivedAtCustomerAt.toISOString() : null,
      lat: order.lat != null ? Number(order.lat) : null,
      lng: order.lng != null ? Number(order.lng) : null,
      createdAt: order.createdAt,
      shopName: order.shop?.name ?? null,
      shopAddress: order.shop?.address ?? null,
      shopLat,
      shopLng,
      customerName: user?.name ?? user?.email ?? null,
      items: order.items.map((i) => ({
        productId: i.productId,
        productName: i.product?.name ?? null,
        quantity: i.quantity,
        price: Number(i.price),
      })),
    });
  } catch (e) {
    console.error("[GET /api/delivery/orders/:id]", e);
    res.status(500).json({ error: "Error al cargar el pedido" });
  }
});

/**
 * PATCH /api/delivery/orders/:id/assign - Assign order to this delivery person (READY_FOR_PICKUP → ASSIGNED).
 */
deliveryOrdersRouter.patch("/orders/:id/assign", async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const order = await prisma.order.findFirst({
      where: { id: orderId, status: "READY_FOR_PICKUP" },
    });
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado o ya asignado" });
    }
    const consumerId = order.userId;
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: "ASSIGNED", deliveryManId },
      }),
      prisma.deliveryMan.update({
        where: { id: deliveryManId },
        data: { status: "ONLINE", lastSeenAt: new Date() },
      }),
    ]);
    void notifyConsumerOrderStatusIfConfigured(consumerId, orderId, "ASSIGNED").catch((e) =>
      console.error("[push] ASSIGNED", e)
    );
    res.json({ ok: true, status: "ASSIGNED" });
  } catch (e) {
    console.error("[PATCH /api/delivery/orders/:id/assign]", e);
    res.status(500).json({ error: "Error al asignar el pedido" });
  }
});

/**
 * PATCH /api/delivery/orders/:id/start - Start delivery (ASSIGNED → ON_DELIVERY).
 */
deliveryOrdersRouter.patch("/orders/:id/start", async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const order = await prisma.order.findFirst({
      where: { id: orderId, deliveryManId, status: "ASSIGNED" },
    });
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado o no asignado a ti" });
    }
    const consumerId = order.userId;
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: {
          status: "ON_DELIVERY",
          estimatedDeliveryMinutes: null,
          onDeliveryStartedAt: new Date(),
        },
      }),
      prisma.deliveryMan.update({
        where: { id: deliveryManId },
        data: { status: "ON_DELIVERY", lastSeenAt: new Date() },
      }),
    ]);
    void notifyConsumerOrderStatusIfConfigured(consumerId, orderId, "ON_DELIVERY").catch((e) =>
      console.error("[push] ON_DELIVERY", e)
    );
    res.json({ ok: true, status: "ON_DELIVERY" });
  } catch (e) {
    console.error("[PATCH /api/delivery/orders/:id/start]", e);
    res.status(500).json({ error: "Error al iniciar el envío" });
  }
});

/**
 * PATCH /api/delivery/orders/:id/arrived - Repartidor indica que llegó al domicilio (sigue ON_DELIVERY).
 * Requisito previo para marcar entregado.
 */
deliveryOrdersRouter.patch("/orders/:id/arrived", async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const order = await prisma.order.findFirst({
      where: { id: orderId, deliveryManId, status: "ON_DELIVERY" },
    });
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado o no en ruta" });
    }
    if (order.arrivedAtCustomerAt) {
      return res.json({
        ok: true,
        arrived_at_customer_at: order.arrivedAtCustomerAt.toISOString(),
      });
    }
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { arrivedAtCustomerAt: new Date() },
    });
    res.json({
      ok: true,
      arrived_at_customer_at: updated.arrivedAtCustomerAt!.toISOString(),
    });
  } catch (e) {
    console.error("[PATCH /api/delivery/orders/:id/arrived]", e);
    res.status(500).json({ error: "Error al registrar llegada" });
  }
});

/**
 * PATCH /api/delivery/orders/:id/delivered - Mark order as delivered (ON_DELIVERY → DELIVERED).
 * Requiere haber llamado antes a .../arrived (arrivedAtCustomerAt).
 */
deliveryOrdersRouter.patch("/orders/:id/delivered", async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const deliveryManId = (req as typeof req & { deliveryManId: string }).deliveryManId;
    const order = await prisma.order.findFirst({
      where: { id: orderId, deliveryManId, status: "ON_DELIVERY" },
    });
    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado o no en curso" });
    }
    if (!order.arrivedAtCustomerAt) {
      return res.status(400).json({
        error: "Primero confirma que llegaste con el pedido (botón Llegué).",
      });
    }
    const now = new Date();
    const xpGain = xpForDelivery(order.onDeliveryStartedAt, now);
    const consumerId = order.userId;
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "DELIVERED",
          estimatedDeliveryMinutes: null,
          deliveredAt: now,
        },
      });
      await applyConsumerOrderDelivered(
        tx,
        { id: order.id, userId: order.userId, total: order.total },
        now
      );
      const dm = await tx.deliveryMan.findUniqueOrThrow({ where: { id: deliveryManId } });
      const streak = computeStreakUpdate(dm.lastStreakDate, dm.currentStreakDays, now);
      const stillOnDelivery = await tx.order.count({
        where: {
          deliveryManId,
          status: "ON_DELIVERY",
          id: { not: orderId },
        },
      });
      const nextDmStatus =
        stillOnDelivery > 0 ? ("ON_DELIVERY" as const) : ("ONLINE" as const);
      await tx.deliveryMan.update({
        where: { id: deliveryManId },
        data: {
          xp: { increment: xpGain },
          totalDeliveries: { increment: 1 },
          currentStreakDays: streak.currentStreakDays,
          lastStreakDate: streak.lastStreakDate,
          status: nextDmStatus,
          lastSeenAt: now,
        },
      });
    });
    void notifyConsumerOrderStatusIfConfigured(consumerId, orderId, "DELIVERED").catch((e) =>
      console.error("[push] DELIVERED", e)
    );
    res.json({ ok: true, status: "DELIVERED", xp_gained: xpGain });
  } catch (e) {
    console.error("[PATCH /api/delivery/orders/:id/delivered]", e);
    res.status(500).json({ error: "Error al marcar como entregado" });
  }
});
