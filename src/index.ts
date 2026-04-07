import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter } from "./routes/auth.js";
import { addressesRouter } from "./routes/addresses.js";
import { appRouter } from "./routes/app.js";
import { adsRouter } from "./routes/ads.js";
import { shopsRouter } from "./routes/shops.js";
import { servicesRouter } from "./routes/services.js";
import { productsRouter } from "./routes/products.js";
import { deliveryMenRouter } from "./routes/deliveryMen.js";
import { ordersRouter } from "./routes/orders.js";
import { ordersAdminRouter } from "./routes/ordersAdmin.js";
import { shopOrdersRouter } from "./routes/shopOrders.js";
import { shopProductsRouter } from "./routes/shopProducts.js";
import { deliveryOrdersRouter } from "./routes/deliveryOrders.js";
import { analyticsRouter } from "./routes/analytics.js";
import { uploadRouter } from "./routes/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const uploadsDir = path.join(__dirname, "..", "uploads");
const imageContentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = imageContentTypes[ext];
      if (contentType) res.setHeader("Content-Type", contentType);
    },
  })
);

app.use("/api/auth", authRouter);
app.use("/api/addresses", addressesRouter);
app.use("/api/app", appRouter);
app.use("/api/ads", adsRouter);
app.use("/api/shops", shopsRouter);
app.use("/api/services", servicesRouter);
app.use("/api/products", productsRouter);
app.use("/api/delivery-men", deliveryMenRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/admin/orders", ordersAdminRouter);
app.use("/api/shop", shopOrdersRouter);
app.use("/api/shop", shopProductsRouter);
app.use("/api/delivery", deliveryOrdersRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/upload", uploadRouter);

const HOST = process.env.HOST ?? "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Ewe backend listening on http://${HOST}:${PORT} (emulator: http://10.0.2.2:${PORT})`);
});
