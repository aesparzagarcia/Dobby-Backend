import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";
import { geocodeAddressNominatim } from "../lib/geocodeNominatim.js";

export const ordersAdminRouter = Router();

ordersAdminRouter.use(requireAdmin);

/**
 * GET /api/admin/orders/:orderId/tracking — map + detail for ASSIGNED / ON_DELIVERY (admin)
 */
ordersAdminRouter.get("/:orderId/tracking", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await prisma.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        userId: true,
        deliveryAddress: true,
        lat: true,
        lng: true,
        shop: {
          select: { id: true, name: true, address: true, lat: true, lng: true },
        },
        deliveryMan: {
          select: {
            id: true,
            name: true,
            status: true,
            celphone: true,
            lastLat: true,
            lastLng: true,
            lastSeenAt: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const customer = await prisma.user.findUnique({
      where: { id: order.userId },
      select: { id: true, email: true, name: true, lastName: true },
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

    return res.json({
      id: order.id,
      status: order.status,
      customer: customer ?? null,
      delivery: {
        address: order.deliveryAddress,
        lat: order.lat != null ? Number(order.lat) : null,
        lng: order.lng != null ? Number(order.lng) : null,
      },
      shop: order.shop
        ? {
            id: order.shop.id,
            name: order.shop.name,
            address: order.shop.address,
            lat: shopLat,
            lng: shopLng,
          }
        : null,
      deliveryMan: order.deliveryMan
        ? {
            id: order.deliveryMan.id,
            name: order.deliveryMan.name,
            status: order.deliveryMan.status,
            celphone: order.deliveryMan.celphone,
            lastLat: order.deliveryMan.lastLat != null ? Number(order.deliveryMan.lastLat) : null,
            lastLng: order.deliveryMan.lastLng != null ? Number(order.deliveryMan.lastLng) : null,
            lastSeenAt: order.deliveryMan.lastSeenAt,
            user: order.deliveryMan.user,
          }
        : null,
    });
  } catch (e) {
    console.error("[GET /api/admin/orders/:orderId/tracking]", e);
    return res.status(500).json({ error: "Error al cargar el seguimiento" });
  }
});

/**
 * GET /api/admin/orders - List all orders for dashboard (admin only)
 */
ordersAdminRouter.get("/", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const validStatuses: Array<"PENDING" | "CONFIRMED" | "PREPARING" | "READY_FOR_PICKUP" | "ASSIGNED" | "ON_DELIVERY" | "DELIVERED" | "CANCELLED"> =
      ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "ASSIGNED", "ON_DELIVERY", "DELIVERED", "CANCELLED"];
    const where = status && validStatuses.includes(status as typeof validStatuses[number])
      ? { status: status as typeof validStatuses[number] }
      : {};

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        shop: {
          select: { id: true, name: true },
        },
        deliveryMan: {
          select: {
            id: true,
            name: true,
            status: true,
            user: { select: { email: true } },
          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Include customer info (userId only - User might not be in schema for client orders; check schema)
    const userIds = [...new Set(orders.map((o) => o.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true, lastName: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const list = orders.map((o) => ({
      id: o.id,
      status: o.status,
      total: Number(o.total),
      deliveryAddress: o.deliveryAddress,
      estimatedPreparationMinutes: o.estimatedPreparationMinutes ?? null,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      shopId: o.shopId,
      shop: o.shop,
      deliveryManId: o.deliveryManId,
      deliveryMan: o.deliveryMan,
      items: o.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product?.name,
        quantity: i.quantity,
        price: Number(i.price),
      })),
      customer: userMap[o.userId] ?? null,
    }));

    res.json(list);
  } catch (e) {
    console.error("[GET /api/admin/orders]", e);
    res.status(500).json({ error: "Error al cargar los pedidos" });
  }
});
