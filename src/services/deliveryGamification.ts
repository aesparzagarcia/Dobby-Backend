import type { PrismaClient } from "@prisma/client";

type OrderDelegate = Pick<PrismaClient, "order">;

/** Racha y misiones usan inicio del día en UTC (documentado para el producto). */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export const XP_BASE_DELIVERY = 50;
export const XP_QUICK_BONUS = 25;
/** Entrega \"rápida\" si ON_DELIVERY → entregado en ≤ este tiempo. */
export const QUICK_DELIVERY_MAX_MS = 30 * 60 * 1000;

export const MISSION_DELIVERIES_TODAY_GOAL = 10;
export const MISSION_QUICK_DELIVERIES_TODAY_GOAL = 3;

export const LEVELS = [
  { key: "NOVATO", minXp: 0 },
  { key: "RAPIDO", minXp: 500 },
  { key: "PRO", minXp: 1500 },
  { key: "ELITE", minXp: 3000 },
  { key: "MASTER_DOB", minXp: 6000 },
] as const;

export type LevelKey = (typeof LEVELS)[number]["key"];

export function levelInfoFromXp(xp: number): {
  levelKey: LevelKey;
  xpAtLevelStart: number;
  xpForNextLevel: number | null;
} {
  let idx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXp) {
      idx = i;
      break;
    }
  }
  const levelKey = LEVELS[idx].key;
  const xpAtLevelStart = LEVELS[idx].minXp;
  const xpForNextLevel = idx + 1 < LEVELS.length ? LEVELS[idx + 1].minXp : null;
  return { levelKey, xpAtLevelStart, xpForNextLevel };
}

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addCalendarDaysIso(isoDay: string, deltaDays: number): string {
  const [y, m, dd] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/**
 * Primera entrega del día que avanza la racha: si ayer ya hubo actividad → +1 día; si hay hueco → reinicio a 1.
 * Entregas adicionales el mismo día UTC no cambian la racha.
 */
export function computeStreakUpdate(
  lastStreakDate: Date | null,
  currentStreakDays: number,
  now: Date
): { currentStreakDays: number; lastStreakDate: Date } {
  const today = utcDayString(now);
  const last = lastStreakDate ? utcDayString(lastStreakDate) : null;
  let streak = currentStreakDays;
  if (last === today) {
    // sin cambio
  } else if (last === null) {
    streak = 1;
  } else if (last === addCalendarDaysIso(today, -1)) {
    streak = currentStreakDays + 1;
  } else {
    streak = 1;
  }
  const [yt, mt, dt] = today.split("-").map(Number);
  return {
    currentStreakDays: streak,
    lastStreakDate: new Date(Date.UTC(yt, mt - 1, dt)),
  };
}

export function xpForDelivery(onDeliveryStartedAt: Date | null, deliveredAt: Date): number {
  let xp = XP_BASE_DELIVERY;
  if (onDeliveryStartedAt) {
    const dt = deliveredAt.getTime() - onDeliveryStartedAt.getTime();
    if (dt >= 0 && dt <= QUICK_DELIVERY_MAX_MS) xp += XP_QUICK_BONUS;
  }
  return xp;
}

export type MissionDto = {
  id: string;
  title: string;
  progress: number;
  goal: number;
  completed: boolean;
};

export async function getMissionsForDeliveryMan(
  db: OrderDelegate,
  deliveryManId: string,
  now: Date = new Date()
): Promise<MissionDto[]> {
  const start = startOfUtcDay(now);
  const deliveriesToday = await db.order.count({
    where: {
      deliveryManId,
      status: "DELIVERED",
      deliveredAt: { gte: start },
    },
  });

  const todaysDelivered = await db.order.findMany({
    where: {
      deliveryManId,
      status: "DELIVERED",
      deliveredAt: { gte: start },
    },
    select: { onDeliveryStartedAt: true, deliveredAt: true },
  });
  let quickToday = 0;
  for (const o of todaysDelivered) {
    if (o.onDeliveryStartedAt && o.deliveredAt) {
      const ms = o.deliveredAt.getTime() - o.onDeliveryStartedAt.getTime();
      if (ms >= 0 && ms <= QUICK_DELIVERY_MAX_MS) quickToday++;
    }
  }

  return [
    {
      id: "deliveries_today",
      title: "Entregas hoy",
      progress: deliveriesToday,
      goal: MISSION_DELIVERIES_TODAY_GOAL,
      completed: deliveriesToday >= MISSION_DELIVERIES_TODAY_GOAL,
    },
    {
      id: "quick_deliveries_today",
      title: "Entregas rápidas (≤30 min en ruta)",
      progress: quickToday,
      goal: MISSION_QUICK_DELIVERIES_TODAY_GOAL,
      completed: quickToday >= MISSION_QUICK_DELIVERIES_TODAY_GOAL,
    },
  ];
}
