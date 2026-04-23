import type { OrderCancelSource, PrismaClient } from "@prisma/client";

/** Blend: reciente pesa más para permitir recuperación. */
export const WEIGHT_LAST_7D = 0.5;
export const WEIGHT_DAYS_8_30 = 0.35;
export const WEIGHT_HISTORICAL = 0.15;

/** Histórico = pedidos con createdAt entre 30 y 180 días. */
export const HISTORICAL_MAX_DAYS = 180;

export type RestaurantLevelKey = "ELITE" | "PRO" | "REGULAR" | "AT_RISK";

const MS_DAY = 86_400_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function levelFromScore(score: number): RestaurantLevelKey {
  if (score >= 90) return "ELITE";
  if (score >= 75) return "PRO";
  if (score >= 50) return "REGULAR";
  return "AT_RISK";
}

/** Progreso 0–1 hacia el mínimo del siguiente nivel. */
export function progressToNextLevel(score: number): { progress: number; next_level_min_score: number | null } {
  const s = clamp(score, 0, 100);
  if (s >= 100) return { progress: 1, next_level_min_score: null };
  if (s >= 90) return { progress: (s - 90) / 10, next_level_min_score: 100 };
  if (s >= 75) return { progress: (s - 75) / 15, next_level_min_score: 90 };
  if (s >= 50) return { progress: (s - 50) / 25, next_level_min_score: 75 };
  return { progress: s / 50, next_level_min_score: 50 };
}

type OrderRow = {
  id: string;
  status: string;
  createdAt: Date;
  shopRating: number | null;
  estimatedPreparationMinutes: number | null;
  preparingAt: Date | null;
  readyForPickupAt: Date | null;
  cancelSource: OrderCancelSource | null;
};

function isShopAttributedCancel(source: OrderCancelSource | null): boolean {
  return source === "SHOP_REJECT_PENDING" || source === "SHOP_CANCEL_AFTER_CONFIRM";
}

function isRejectPending(source: OrderCancelSource | null): boolean {
  return source === "SHOP_REJECT_PENDING";
}

/** Subscore 0–100 para una ventana; `neutralIfEmpty` cuando no hay pedidos en esa ventana. */
function windowScore(
  orders: OrderRow[],
  neutralIfEmpty: number,
  shopAggregateRate: number | null,
): { score: number; metrics: WindowMetrics } {
  if (orders.length === 0) {
    return {
      score: neutralIfEmpty,
      metrics: {
        orders_delivered: 0,
        orders_cancelled_shop: 0,
        reject_pending: 0,
        cancel_after_confirm: 0,
        acceptance_rate_pct: 100,
        on_time_prep_pct: null as number | null,
        avg_prep_minutes: null as number | null,
        rated_orders: 0,
        avg_shop_rating: null as number | null,
      },
    };
  }

  let delivered = 0;
  let cancelShop = 0;
  let rejectP = 0;
  let cancelAfter = 0;
  let prepOnTime = 0;
  let prepTotal = 0;
  let prepMinutesSum = 0;
  let prepMinutesCount = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const o of orders) {
    if (o.status === "DELIVERED") {
      delivered++;
      if (o.shopRating != null && o.shopRating >= 1 && o.shopRating <= 5) {
        ratingSum += o.shopRating;
        ratingCount++;
      }
    }
    if (o.status === "CANCELLED" && isShopAttributedCancel(o.cancelSource)) {
      cancelShop++;
      if (isRejectPending(o.cancelSource)) rejectP++;
      if (o.cancelSource === "SHOP_CANCEL_AFTER_CONFIRM") cancelAfter++;
    }

    if (
      o.preparingAt &&
      o.readyForPickupAt &&
      o.estimatedPreparationMinutes != null &&
      o.estimatedPreparationMinutes > 0
    ) {
      const actualMin = (o.readyForPickupAt.getTime() - o.preparingAt.getTime()) / 60_000;
      if (actualMin >= 0 && actualMin < 24 * 60) {
        prepTotal++;
        prepMinutesSum += actualMin;
        prepMinutesCount++;
        const est = o.estimatedPreparationMinutes;
        if (actualMin <= est) prepOnTime++;
        else if (actualMin <= est * 1.15) prepOnTime += 0.5;
      }
    }
  }

  const terminal = delivered + cancelShop;
  const completion = terminal > 0 ? (100 * delivered) / terminal : neutralIfEmpty;

  const nonPending = orders.filter((o) => o.status !== "PENDING").length;
  const acceptanceClamped =
    nonPending > 0 ? clamp((100 * (nonPending - rejectP)) / nonPending, 0, 100) : 100;

  let prepScore = 72;
  if (prepTotal > 0) {
    prepScore = clamp((prepOnTime / prepTotal) * 100, 0, 100);
  }

  let ratingScore = 75;
  if (ratingCount > 0) {
    const avg = ratingSum / ratingCount;
    ratingScore = clamp((avg / 5) * 100, 0, 100);
  } else if (shopAggregateRate != null && shopAggregateRate > 0) {
    ratingScore = clamp((shopAggregateRate / 5) * 100, 0, 100);
  }

  const wCompletion = 0.35;
  const wAccept = 0.3;
  const wPrep = 0.2;
  const wRating = 0.15;

  const score = clamp(
    wCompletion * completion + wAccept * acceptanceClamped + wPrep * prepScore + wRating * ratingScore,
    0,
    100
  );

  const avgPrep = prepMinutesCount > 0 ? prepMinutesSum / prepMinutesCount : null;
  const onTimePct = prepTotal > 0 ? Math.round((prepOnTime / prepTotal) * 100) : null;

  return {
    score,
    metrics: {
      orders_delivered: delivered,
      orders_cancelled_shop: cancelShop,
      reject_pending: rejectP,
      cancel_after_confirm: cancelAfter,
      acceptance_rate_pct: Math.round(acceptanceClamped * 10) / 10,
      on_time_prep_pct: onTimePct,
      avg_prep_minutes: avgPrep != null ? Math.round(avgPrep * 10) / 10 : null,
      rated_orders: ratingCount,
      avg_shop_rating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    },
  };
}

type WindowMetrics = {
  orders_delivered: number;
  orders_cancelled_shop: number;
  reject_pending: number;
  cancel_after_confirm: number;
  acceptance_rate_pct: number;
  on_time_prep_pct: number | null;
  avg_prep_minutes: number | null;
  rated_orders: number;
  avg_shop_rating: number | null;
};

export type ShopProfileBreakdown = WindowMetrics & {
  orders_last_7d: number;
  orders_last_30d: number;
  shop_rate_aggregate: number;
  shop_rating_count_aggregate: number;
};

export type ShopProfilePayload = {
  name: string;
  logo_url: string | null;
  restaurant_score: number;
  level_key: RestaurantLevelKey;
  progress_to_next_level: number;
  next_level_min_score: number | null;
  score_blend_weights: { last_7d: number; days_8_to_30: number; historical: number };
  breakdown: ShopProfileBreakdown;
  insights: string[];
  missions: { id: string; title: string; progress: number; goal: number; completed: boolean }[];
};

function sliceOrders(orders: OrderRow[], from: Date, to: Date): OrderRow[] {
  return orders.filter((o) => o.createdAt >= from && o.createdAt < to);
}

export async function computeRestaurantProfile(prisma: PrismaClient, shopId: string): Promise<ShopProfilePayload> {
  const now = Date.now();
  const d7 = new Date(now - 7 * MS_DAY);
  const d30 = new Date(now - 30 * MS_DAY);
  const d180 = new Date(now - HISTORICAL_MAX_DAYS * MS_DAY);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { name: true, logoUrl: true, rate: true, ratingCount: true },
  });
  if (!shop) {
    throw new Error("Shop not found");
  }

  const orders = await prisma.order.findMany({
    where: {
      shopId,
      createdAt: { gte: d180 },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      shopRating: true,
      estimatedPreparationMinutes: true,
      preparingAt: true,
      readyForPickupAt: true,
      cancelSource: true,
    },
  });

  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    status: o.status,
    createdAt: o.createdAt,
    shopRating: o.shopRating,
    estimatedPreparationMinutes: o.estimatedPreparationMinutes,
    preparingAt: o.preparingAt,
    readyForPickupAt: o.readyForPickupAt,
    cancelSource: o.cancelSource,
  }));

  const neutral = 72;
  const aggRate = shop.ratingCount > 0 ? shop.rate : null;
  const w7 = sliceOrders(rows, d7, new Date(now + 1));
  const w30only = sliceOrders(rows, d30, d7);
  const hist = sliceOrders(rows, d180, d30);

  const r7 = windowScore(w7, neutral, aggRate);
  const r30 = windowScore(w30only, neutral, aggRate);
  const rH = windowScore(hist, neutral, aggRate);

  const blended =
    WEIGHT_LAST_7D * r7.score + WEIGHT_DAYS_8_30 * r30.score + WEIGHT_HISTORICAL * rH.score;
  const restaurant_score = Math.round(clamp(blended, 0, 100));

  const level_key = levelFromScore(restaurant_score);
  const { progress, next_level_min_score } = progressToNextLevel(restaurant_score);

  const breakdown: ShopProfileBreakdown = {
    ...r7.metrics,
    orders_last_7d: w7.length,
    orders_last_30d: w30only.length + w7.length,
    shop_rate_aggregate: Math.round((shop.ratingCount > 0 ? shop.rate : 0) * 10) / 10,
    shop_rating_count_aggregate: shop.ratingCount,
  };

  const insights: string[] = [];
  if (r7.metrics.reject_pending > 0 && r30.metrics.reject_pending === 0) {
    insights.push("En los últimos 7 días rechazaste pedidos pendientes; evítalo para subir tu aceptación.");
  }
  if (r7.metrics.cancel_after_confirm > r30.metrics.cancel_after_confirm && r7.metrics.cancel_after_confirm > 0) {
    insights.push("Subieron las cancelaciones después de aceptar respecto al periodo anterior.");
  }
  if (
    r7.metrics.on_time_prep_pct != null &&
    r30.metrics.on_time_prep_pct != null &&
    r7.metrics.on_time_prep_pct < r30.metrics.on_time_prep_pct - 10
  ) {
    insights.push("Estás tardando más en preparación que en semanas anteriores.");
  }
  if (restaurant_score < 50) {
    insights.push("Tu índice está en zona de riesgo; mejora aceptación y tiempos para recuperar visibilidad.");
  } else if (restaurant_score >= 90) {
    insights.push("¡Nivel Elite! Mantén la constancia para conservar la máxima visibilidad.");
  }
  if (insights.length === 0 && w7.length >= 3) {
    insights.push("Sigue así: tu actividad reciente es estable.");
  }

  return {
    name: shop.name,
    logo_url: shop.logoUrl,
    restaurant_score,
    level_key,
    progress_to_next_level: Math.round(progress * 1000) / 1000,
    next_level_min_score,
    score_blend_weights: {
      last_7d: WEIGHT_LAST_7D,
      days_8_to_30: WEIGHT_DAYS_8_30,
      historical: WEIGHT_HISTORICAL,
    },
    breakdown,
    insights,
    missions: [],
  };
}
