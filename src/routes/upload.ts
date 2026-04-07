import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { writeFile, mkdir } from "fs/promises";
import { getAuthUser } from "../middleware/auth.js";
import { verifyAccessToken } from "../lib/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_BASE = path.join(__dirname, "..", "..", "uploads");

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes (JPEG, PNG, GIF, WebP)"));
  },
});

function requireAdminUpload(req: Request, res: Response, next: NextFunction) {
  let user = getAuthUser(req);
  if (!user && req.body?.token) {
    user = verifyAccessToken(String(req.body.token).trim());
  }
  if (!user || user.role !== "ADMIN") {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

/** Admin panel or Ewe-Shop app (Bearer de tienda) para fotos de producto. */
function requireAdminOrShopUpload(req: Request, res: Response, next: NextFunction) {
  let user = getAuthUser(req);
  if (!user && req.body?.token) {
    user = verifyAccessToken(String(req.body.token).trim());
  }
  if (!user || (user.role !== "ADMIN" && user.role !== "SHOP")) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

export const uploadRouter = Router();

async function saveFile(buffer: Buffer, subdir: string, filename: string): Promise<string> {
  const dir = path.join(UPLOADS_BASE, subdir);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await writeFile(filePath, buffer);
  const urlPath = `/uploads/${subdir.replace(/\\/g, "/")}/${filename}`;
  return urlPath;
}

uploadRouter.post("/shop-logo", upload.single("file"), requireAdminUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió ningún archivo" });
  const ext = path.extname(req.file.originalname) || ".jpg";
  const safe = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext.toLowerCase()) ? ext : ".jpg";
  const filename = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
  try {
    const url = await saveFile(req.file.buffer, "shops", filename);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al guardar la imagen" });
  }
});

uploadRouter.post("/product-image", upload.single("file"), requireAdminOrShopUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió ningún archivo" });
  const ext = path.extname(req.file.originalname) || ".jpg";
  const safe = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext.toLowerCase()) ? ext : ".jpg";
  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
  try {
    const url = await saveFile(req.file.buffer, "products", filename);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al guardar la imagen" });
  }
});

uploadRouter.post("/service-logo", upload.single("file"), requireAdminUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió ningún archivo" });
  const ext = path.extname(req.file.originalname) || ".jpg";
  const safe = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext.toLowerCase()) ? ext : ".jpg";
  const filename = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
  try {
    const url = await saveFile(req.file.buffer, "services", filename);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al guardar la imagen" });
  }
});

uploadRouter.post("/delivery-id", upload.single("file"), requireAdminUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió ningún archivo" });
  const side = req.body?.side === "back" ? "back" : "front";
  const subDir = side === "back" ? "id-back" : "id-front";
  const ext = path.extname(req.file.originalname) || ".jpg";
  const safe = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext.toLowerCase()) ? ext : ".jpg";
  const filename = `id-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
  try {
    const url = await saveFile(req.file.buffer, path.join("delivery-men", subDir), filename);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al guardar la imagen" });
  }
});

uploadRouter.post("/delivery-profile", upload.single("file"), requireAdminUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió ningún archivo" });
  const ext = path.extname(req.file.originalname) || ".jpg";
  const safe = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext.toLowerCase()) ? ext : ".jpg";
  const filename = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
  try {
    const url = await saveFile(req.file.buffer, path.join("delivery-men", "profile"), filename);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al guardar la imagen" });
  }
});

uploadRouter.post("/ad-image", upload.single("file"), requireAdminUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se envió ningún archivo" });
  const ext = path.extname(req.file.originalname) || ".jpg";
  const safe = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext.toLowerCase()) ? ext : ".jpg";
  const filename = `ad-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`;
  try {
    const url = await saveFile(req.file.buffer, "ads", filename);
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al guardar la imagen" });
  }
});
