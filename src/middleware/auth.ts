import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type JWTPayload } from "../lib/auth.js";

function getTokenFromReq(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = cookie.match(/ewe_token=([^;]+)/);
    if (m) try { return decodeURIComponent(m[1].trim()); } catch { return m[1].trim(); }
  }
  const x = req.headers["x-auth-token"];
  if (x && typeof x === "string") return x.trim();
  const body = req.body?.token;
  if (typeof body === "string") return body.trim();
  return null;
}

export function getAuthUser(req: Request): JWTPayload | null {
  const token = getTokenFromReq(req);
  if (!token) return null;
  return verifyAccessToken(token);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getAuthUser(req);
  if (!user || user.role !== "ADMIN") {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  (req as Request & { user: JWTPayload }).user = user;
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const token = getTokenFromReq(req);
  if (!token) {
    console.warn(
      "[requireUser] Unauthorized: no token (expected Authorization: Bearer <access> or ewe_token cookie)"
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = verifyAccessToken(token);
  if (!user) {
    console.warn(
      "[requireUser] Unauthorized: access token invalid or expired (apps should POST /api/auth/refresh with refreshToken)"
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as Request & { user: JWTPayload }).user = user;
  next();
}

/** For Ewe-Shop app: JWT must have role SHOP and sub = shopId. Sets req.shopId. */
export function requireShop(req: Request, res: Response, next: NextFunction): void {
  const payload = getAuthUser(req);
  if (!payload || payload.role !== "SHOP") {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  (req as Request & { user: JWTPayload; shopId: string }).user = payload;
  (req as Request & { user: JWTPayload; shopId: string }).shopId = payload.sub;
  next();
}

/** For Ewe-Man app: JWT must have role DELIVERY and sub = deliveryManId. Sets req.deliveryManId. */
export function requireDelivery(req: Request, res: Response, next: NextFunction): void {
  const payload = getAuthUser(req);
  if (!payload || payload.role !== "DELIVERY") {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  (req as Request & { user: JWTPayload; deliveryManId: string }).user = payload;
  (req as Request & { user: JWTPayload; deliveryManId: string }).deliveryManId = payload.sub;
  next();
}
