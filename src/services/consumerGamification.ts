import type { Prisma, Order, PrismaClient } from "@prisma/client";
import { computeStreakUpdate } from "./deliveryGamification.js";

/** XP from order total: min(floor(total/10), 20) — total in same currency units as stored. */
export const XP_PURCHASE_CAP = 20;
export const XP_FIRST_ORDER = 50;
export const XP_PEAK_HOUR = 5;
export const XP_RATE_ORDER = 5;
export const XP_FIVE_STARS_EXTRA = 3;
export const XP_STREAK_PER_DAY = 5;
export const XP_STREAK_MAX = 25;

export const CONSUMER_LEVELS = [
  { key: "EXPLORADOR", minXp: 0, displayName: "Explorador" },
  { key: "FRECUENTE", minXp: 200, displayName: "Frecuente" },
  { key: "FAN", minXp: 500, displayName: "Fan" },
  { key: "VIP", minXp: 1200, displayName: "VIP" },
  { key: "DOBBY_MASTER", minXp: 2500, displayName: "Dobby Master" },
] as const;

export type ConsumerLevelKey = (typeof CONSUMER_LEVELS)[number]["key"];

export function consumerLevelInfoFromXp(xp: number): {
  levelKey: ConsumerLevelKey;
  displayName: string;
  xpAtLevelStart: number;
  xpForNextLevel: number | null;
} {
  let idx = 0;
  for (let i = CONSUMER_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= CONSUMER_LEVELS[i].minXp) {
      idx = i;
      break;
    }
  }
  const levelKey = CONSUMER_LEVELS[idx].key;
  const displayName = CONSUMER_LEVELS[idx].displayName;
  const xpAtLevelStart = CONSUMER_LEVELS[idx].minXp;
  const xpForNextLevel = idx + 1 < CONSUMER_LEVELS.length ? CONSUMER_LEVELS[idx + 1].minXp : null;
  return { levelKey, displayName, xpAtLevelStart, xpForNextLevel };
}

export function xpFromPurchaseTotal(total: number): number {
  const t = Math.max(0, total);
  return Math.min(Math.floor(t / 10), XP_PURCHASE_CAP);
}

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Peak = lunch UTC 12–14 or dinner 19–21 (adjust for product later). */
export function isPeakHourUtc(now: Date): boolean {
  const h = now.getUTCHours();
  return (h >= 12 && h < 14) || (h >= 19 && h < 21);
}

async function applyXpDelta(
  tx: Prisma.TransactionClient,
  userId: string,
  delta: number,
  reason: string,
  idempotencyKey: string,
  orderId: string | null
): Promise<boolean> {
  const existing = await tx.userXpLedger.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return false;
  await tx.userXpLedger.create({
    data: {
      userId,
      delta,
      reason,
      orderId,
      idempotencyKey,
    },
  });
  await tx.user.update({
    where: { id: userId },
    data: { dobbyXp: { increment: delta } },
  });
  return true;
}

/**
 * Called inside the same transaction that sets order to DELIVERED.
 * Awards purchase XP, first-order, peak, streak (once per UTC day), streak-based bonus.
 */
export async function applyConsumerOrderDelivered(
  tx: Prisma.TransactionClient,
  order: Pick<Order, "id" | "userId" | "total">,
  now: Date
): Promise<void> {
  const userId = order.userId;
  const orderId = order.id;
  const total = Number(order.total);

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      dobbyXp: true,
      orderStreakDays: true,
      lastOrderStreakDate: true,
    },
  });

  const priorDelivered = await tx.order.count({
    where: {
      userId,
      status: "DELIVERED",
      id: { not: orderId },
    },
  });

  const purchaseXp = xpFromPurchaseTotal(total);
  if (purchaseXp > 0) {
    await applyXpDelta(tx, userId, purchaseXp, "purchase", `purchase:${orderId}`, orderId);
  }

  if (priorDelivered === 0) {
    await applyXpDelta(tx, userId, XP_FIRST_ORDER, "first_order", `first_order:${userId}`, orderId);
  }

  if (isPeakHourUtc(now)) {
    await applyXpDelta(tx, userId, XP_PEAK_HOUR, "peak_hour", `peak_hour:${orderId}`, orderId);
  }

  const streak = computeStreakUpdate(user.lastOrderStreakDate, user.orderStreakDays, now);

  await tx.user.update({
    where: { id: userId },
    data: {
      orderStreakDays: streak.currentStreakDays,
      lastOrderStreakDate: streak.lastStreakDate,
    },
  });

  const day = utcDayString(now);
  const streakBonus = Math.min(XP_STREAK_PER_DAY * streak.currentStreakDays, XP_STREAK_MAX);
  if (streakBonus > 0) {
    await applyXpDelta(
      tx,
      userId,
      streakBonus,
      "order_streak",
      `streak_xp:${userId}:${day}`,
      orderId
    );
  }
}

/**
 * After customer rates delivery (POST /orders/:id/rate-delivery).
 */
export async function applyConsumerDeliveryRatingXp(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  stars: number
): Promise<void> {
  let delta = XP_RATE_ORDER;
  if (stars === 5) delta += XP_FIVE_STARS_EXTRA;
  await applyXpDelta(tx, userId, delta, "rate_delivery", `rate_delivery:${orderId}`, orderId);
}

export type GamificationSnapshot = {
  dobby_xp: number;
  level_key: ConsumerLevelKey;
  level_name: string;
  xp_at_level_start: number;
  xp_for_next_level: number | null;
  order_streak_days: number;
  total_orders_delivered: number;
  /** Perfil básico del usuario (Dobby app). */
  name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  recent_events: Array<{
    delta: number;
    reason: string;
    created_at: string;
  }>;
};

export async function getConsumerGamificationSnapshot(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string
): Promise<GamificationSnapshot> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      dobbyXp: true,
      orderStreakDays: true,
      name: true,
      lastName: true,
      email: true,
      phone: true,
    },
  });
  const totalOrdersDelivered = await db.order.count({
    where: { userId, status: "DELIVERED" },
  });
  const recent = await db.userXpLedger.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { delta: true, reason: true, createdAt: true },
  });
  const info = consumerLevelInfoFromXp(user.dobbyXp);
  return {
    dobby_xp: user.dobbyXp,
    level_key: info.levelKey,
    level_name: info.displayName,
    xp_at_level_start: info.xpAtLevelStart,
    xp_for_next_level: info.xpForNextLevel,
    order_streak_days: user.orderStreakDays,
    total_orders_delivered: totalOrdersDelivered,
    name: user.name,
    last_name: user.lastName,
    email: user.email,
    phone: user.phone,
    recent_events: recent.map((e) => ({
      delta: e.delta,
      reason: e.reason,
      created_at: e.createdAt.toISOString(),
    })),
  };
}
