import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  DELIVERY_PRICING_KEYS,
  loadDeliveryPricingConfig,
  validateAppConfigValue,
} from "../services/deliveryPricingConfig.js";

export const appConfigAdminRouter = Router();

appConfigAdminRouter.use(requireAdmin);

/** Todas las filas de app_config (panel web). */
appConfigAdminRouter.get("/", async (_req, res) => {
  try {
    const rows = await prisma.appConfig.findMany({ orderBy: { id: "asc" } });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load app config" });
  }
});

/** Solo claves de tarifas de envío, parseadas. */
appConfigAdminRouter.get("/delivery-pricing", async (_req, res) => {
  try {
    const config = await loadDeliveryPricingConfig();
    res.json(config);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load delivery pricing config" });
  }
});

/**
 * Actualiza una o varias claves. Body: { key, value } o { items: [{ key, value }] }
 */
appConfigAdminRouter.put("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const items: { key: string; value: unknown }[] = Array.isArray(body.items)
      ? body.items
      : body.key != null
        ? [{ key: String(body.key), value: body.value }]
        : [];

    if (items.length === 0) {
      return res.status(400).json({ error: "Provide key/value or items[]" });
    }

    const updated = [];
    for (const item of items) {
      const key = String(item.key).trim();
      if (!key) continue;
      const existing = await prisma.appConfig.findUnique({ where: { key } });
      if (!existing) {
        return res.status(404).json({ error: `Unknown config key: ${key}` });
      }
      const parsed = validateAppConfigValue(existing.type, item.value);
      if (!parsed.ok) {
        return res.status(400).json({ error: `${key}: ${parsed.error}` });
      }
      const row = await prisma.appConfig.update({
        where: { key },
        data: { value: parsed.value },
      });
      updated.push(row);
    }

    res.json({ updated, deliveryPricing: await loadDeliveryPricingConfig() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update app config" });
  }
});

/** Re-seed solo claves de envío si faltan (útil tras deploy). */
appConfigAdminRouter.post("/delivery-pricing/seed", async (_req, res) => {
  try {
    const seeds: { key: string; value: string; type: "DOUBLE" | "BOOLEAN" }[] = [
      { key: "BASE_FEE", value: "25.0", type: "DOUBLE" },
      { key: "PRICE_PER_KM", value: "7.0", type: "DOUBLE" },
      { key: "WEATHER_FEE", value: "15.0", type: "DOUBLE" },
      { key: "DEFAULT_DEMAND_MULTIPLIER", value: "1.0", type: "DOUBLE" },
      { key: "DEFAULT_IS_RAINING", value: "false", type: "BOOLEAN" },
      { key: "ZONE_A_MAX_KM", value: "3.0", type: "DOUBLE" },
      { key: "ZONE_B_MAX_KM", value: "7.0", type: "DOUBLE" },
      { key: "ZONE_C_MAX_KM", value: "12.0", type: "DOUBLE" },
      { key: "ZONE_B_FEE", value: "10.0", type: "DOUBLE" },
      { key: "ZONE_C_FEE", value: "25.0", type: "DOUBLE" },
      { key: "ZONE_D_FEE", value: "50.0", type: "DOUBLE" },
    ];
    for (const s of seeds) {
      await prisma.appConfig.upsert({
        where: { key: s.key },
        create: { key: s.key, value: s.value, type: s.type },
        update: {},
      });
    }
    res.json({ ok: true, keys: DELIVERY_PRICING_KEYS });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to seed delivery pricing config" });
  }
});
