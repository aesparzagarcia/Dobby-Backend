import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "default-secret-change-me";

export type JWTPayload = {
  sub: string;
  email: string;
  role: string;
  /** Present only on refresh JWTs (shop/delivery mobile) — must not be used as API Bearer access. */
  typ?: string;
  iat?: number;
  exp?: number;
};

const MOBILE_APP_ACCESS_EXPIRES = "15m" as const;
const MOBILE_APP_REFRESH_EXPIRES = "30d" as const;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: payload.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/** Short-lived access token for Ewe-Shop app (Bearer on /shop/*). */
export function signShopAccessToken(payload: { sub: string; email: string }): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: "SHOP" },
    JWT_SECRET,
    { expiresIn: MOBILE_APP_ACCESS_EXPIRES }
  );
}

/** Long-lived refresh token for Ewe-Shop app (POST /auth/shop/refresh only). */
export function signShopRefreshToken(payload: { sub: string; email: string }): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: "SHOP", typ: "refresh" },
    JWT_SECRET,
    { expiresIn: MOBILE_APP_REFRESH_EXPIRES }
  );
}

/** Short-lived access token for Ewe-Man app (Bearer on /delivery/*). */
export function signDeliveryAccessToken(payload: { sub: string; email: string }): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: "DELIVERY" },
    JWT_SECRET,
    { expiresIn: MOBILE_APP_ACCESS_EXPIRES }
  );
}

/** Long-lived refresh token for Ewe-Man (POST /auth/delivery/refresh only). */
export function signDeliveryRefreshToken(payload: { sub: string; email: string }): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: "DELIVERY", typ: "refresh" },
    JWT_SECRET,
    { expiresIn: MOBILE_APP_REFRESH_EXPIRES }
  );
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}

/** Rejects refresh-only JWTs so they cannot be used as API access tokens. */
export function verifyAccessToken(token: string): JWTPayload | null {
  const p = verifyToken(token);
  if (!p || p.typ === "refresh") return null;
  return p;
}

export function verifyShopRefreshToken(token: string): JWTPayload | null {
  const p = verifyToken(token);
  if (!p || p.typ !== "refresh" || p.role !== "SHOP") return null;
  return p;
}

export function verifyDeliveryRefreshToken(token: string): JWTPayload | null {
  const p = verifyToken(token);
  if (!p || p.typ !== "refresh" || p.role !== "DELIVERY") return null;
  return p;
}

/** Short-lived access for Ewe consumer app (Bearer on /orders, /addresses, /app/*, etc.). */
export function signUserAccessToken(payload: { sub: string; email: string; role: string }): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: payload.role },
    JWT_SECRET,
    { expiresIn: MOBILE_APP_ACCESS_EXPIRES }
  );
}

/** Refresh for Ewe consumer app (POST /auth/refresh). Preserves User.role from login. */
export function signUserRefreshToken(payload: { sub: string; email: string; role: string }): string {
  return jwt.sign(
    { sub: payload.sub, email: payload.email, role: payload.role, typ: "refresh" },
    JWT_SECRET,
    { expiresIn: MOBILE_APP_REFRESH_EXPIRES }
  );
}

/** Consumer refresh JWT — not shop or delivery. */
export function verifyConsumerAppRefreshToken(token: string): JWTPayload | null {
  const p = verifyToken(token);
  if (!p || p.typ !== "refresh") return null;
  if (p.role === "SHOP" || p.role === "DELIVERY") return null;
  return p;
}

export function getTokenFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader || typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}
