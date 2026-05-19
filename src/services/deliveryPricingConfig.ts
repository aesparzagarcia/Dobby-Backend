import type { AppConfig, AppConfigType } from "@prisma/client";
import { prisma } from "../lib/db.js";

export const DELIVERY_PRICING_KEYS = [
  "BASE_FEE",
  "PRICE_PER_KM",
  "WEATHER_FEE",
  "DEFAULT_DEMAND_MULTIPLIER",
  "DEFAULT_IS_RAINING",
  "ZONE_A_MAX_KM",
  "ZONE_B_MAX_KM",
  "ZONE_C_MAX_KM",
  "ZONE_B_FEE",
  "ZONE_C_FEE",
  "ZONE_D_FEE",
] as const;

export type DeliveryPricingKey = (typeof DELIVERY_PRICING_KEYS)[number];

export type DeliveryPricingConfigDto = {
  baseFee: number;
  pricePerKm: number;
  weatherFee: number;
  defaultDemandMultiplier: number;
  defaultIsRaining: boolean;
  zoneAMaxKm: number;
  zoneBMaxKm: number;
  zoneCMaxKm: number;
  zoneBFee: number;
  zoneCFee: number;
  zoneDFee: number;
};

const DEFAULTS: DeliveryPricingConfigDto = {
  baseFee: 25,
  pricePerKm: 7,
  weatherFee: 15,
  defaultDemandMultiplier: 1,
  defaultIsRaining: false,
  zoneAMaxKm: 3,
  zoneBMaxKm: 7,
  zoneCMaxKm: 12,
  zoneBFee: 10,
  zoneCFee: 25,
  zoneDFee: 50,
};

function parseConfigValue(row: AppConfig): string | number | boolean {
  const raw = row.value.trim();
  switch (row.type) {
    case "DOUBLE":
      return Number.parseFloat(raw);
    case "BOOLEAN":
      return raw === "true" || raw === "1";
    case "STRING":
    default:
      return raw;
  }
}

function toNumber(v: string | number | boolean, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function toBoolean(v: string | number | boolean, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

export function buildDeliveryPricingConfig(
  rows: AppConfig[]
): DeliveryPricingConfigDto {
  const map = new Map<string, string | number | boolean>();
  for (const row of rows) {
    if (DELIVERY_PRICING_KEYS.includes(row.key as DeliveryPricingKey)) {
      map.set(row.key, parseConfigValue(row));
    }
  }
  return {
    baseFee: toNumber(map.get("BASE_FEE") ?? DEFAULTS.baseFee, DEFAULTS.baseFee),
    pricePerKm: toNumber(map.get("PRICE_PER_KM") ?? DEFAULTS.pricePerKm, DEFAULTS.pricePerKm),
    weatherFee: toNumber(map.get("WEATHER_FEE") ?? DEFAULTS.weatherFee, DEFAULTS.weatherFee),
    defaultDemandMultiplier: toNumber(
      map.get("DEFAULT_DEMAND_MULTIPLIER") ?? DEFAULTS.defaultDemandMultiplier,
      DEFAULTS.defaultDemandMultiplier
    ),
    defaultIsRaining: toBoolean(
      map.get("DEFAULT_IS_RAINING") ?? DEFAULTS.defaultIsRaining,
      DEFAULTS.defaultIsRaining
    ),
    zoneAMaxKm: toNumber(map.get("ZONE_A_MAX_KM") ?? DEFAULTS.zoneAMaxKm, DEFAULTS.zoneAMaxKm),
    zoneBMaxKm: toNumber(map.get("ZONE_B_MAX_KM") ?? DEFAULTS.zoneBMaxKm, DEFAULTS.zoneBMaxKm),
    zoneCMaxKm: toNumber(map.get("ZONE_C_MAX_KM") ?? DEFAULTS.zoneCMaxKm, DEFAULTS.zoneCMaxKm),
    zoneBFee: toNumber(map.get("ZONE_B_FEE") ?? DEFAULTS.zoneBFee, DEFAULTS.zoneBFee),
    zoneCFee: toNumber(map.get("ZONE_C_FEE") ?? DEFAULTS.zoneCFee, DEFAULTS.zoneCFee),
    zoneDFee: toNumber(map.get("ZONE_D_FEE") ?? DEFAULTS.zoneDFee, DEFAULTS.zoneDFee),
  };
}

export async function loadDeliveryPricingConfig(): Promise<DeliveryPricingConfigDto> {
  const rows = await prisma.appConfig.findMany({
    where: { key: { in: [...DELIVERY_PRICING_KEYS] } },
  });
  return buildDeliveryPricingConfig(rows);
}

export function validateAppConfigValue(
  type: AppConfigType,
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: false, error: "value is required" };
  }
  switch (type) {
    case "DOUBLE": {
      const n = typeof value === "number" ? value : Number.parseFloat(String(value));
      if (!Number.isFinite(n)) return { ok: false, error: "invalid DOUBLE" };
      return { ok: true, value: String(n) };
    }
    case "BOOLEAN": {
      if (typeof value === "boolean") {
        return { ok: true, value: value ? "true" : "false" };
      }
      const s = String(value).trim().toLowerCase();
      if (s === "true" || s === "1") return { ok: true, value: "true" };
      if (s === "false" || s === "0") return { ok: true, value: "false" };
      return { ok: false, error: "invalid BOOLEAN" };
    }
    case "STRING":
      return { ok: true, value: String(value) };
    default:
      return { ok: false, error: "unknown type" };
  }
}
