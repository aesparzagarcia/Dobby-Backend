import { Router } from "express";
import { prisma } from "../lib/db.js";
import {
  verifyPassword,
  signToken,
  hashPassword,
  signShopAccessToken,
  signShopRefreshToken,
  verifyShopRefreshToken,
  signDeliveryAccessToken,
  signDeliveryRefreshToken,
  verifyDeliveryRefreshToken,
  signUserAccessToken,
  signUserRefreshToken,
  verifyConsumerAppRefreshToken,
} from "../lib/auth.js";

const OTP_EXPIRES_MINUTES = 10;

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Strip non-digits for phone comparison (e.g. "+52 333 578 3973" -> "523335783973") */
function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Correo y contraseña requeridos" });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    if (!user.passwordHash) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (e) {
    return res.status(500).json({ error: "Error del servidor" });
  }
});

authRouter.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Correo y contraseña requeridos" });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "Correo ya registrado" });
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, role: "ADMIN" },
    });
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (e) {
    return res.status(500).json({ error: "Error del servidor" });
  }
});

// --- OTP flow (mobile app) ---

// Prefix for shop OTPs so they don't collide with generic (customer) OTPs in the same table
const SHOP_OTP_PREFIX = "shop:";

// Shop app: login by Shop phone (not User). Find Shop by phone, send OTP.
authRouter.post("/shop/request-otp", async (req, res) => {
  try {
    const { phone } = req.body || {};
    const normalized = typeof phone === "string" ? phone.trim() : "";
    if (!normalized) {
      return res.status(400).json({ error: "El número de teléfono es requerido" });
    }
    const inputDigits = digitsOnly(normalized);
    if (!inputDigits.length) {
      return res.status(400).json({ error: "El número de teléfono no es válido" });
    }
    // Find Shop by phone (compare digits only)
    const shops = await prisma.shop.findMany({ where: { phone: { not: null } } });
    const shop = shops.find((s) => s.phone && digitsOnly(s.phone) === inputDigits);
    if (!shop) {
      return res.status(400).json({ error: "Número no registrado. Registra tu tienda o restaurante en el panel web." });
    }
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
    const shopOtpKey = SHOP_OTP_PREFIX + normalized;
    await prisma.otpVerification.upsert({
      where: { phone: shopOtpKey },
      create: { phone: shopOtpKey, code, expiresAt },
      update: { code, expiresAt },
    });
    console.log(`[OTP Shop] ${normalized} => ${code} (expires in ${OTP_EXPIRES_MINUTES} min)`);
    return res.json({ sent: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al enviar el código" });
  }
});

// Shop app: verify OTP and return token for the Shop (sub = shop.id, role = SHOP)
authRouter.post("/shop/verify-otp", async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    const normalized = typeof phone === "string" ? phone.trim() : "";
    const codeStr = typeof code === "string" ? code.trim() : "";
    if (!normalized || !codeStr) {
      return res.status(400).json({ error: "Teléfono y código son requeridos" });
    }
    const shopOtpKey = SHOP_OTP_PREFIX + normalized;
    const otp = await prisma.otpVerification.findUnique({ where: { phone: shopOtpKey } });
    if (!otp || otp.code !== codeStr) {
      return res.status(401).json({ error: "Código inválido o expirado" });
    }
    if (new Date() > otp.expiresAt) {
      await prisma.otpVerification.delete({ where: { phone: shopOtpKey } }).catch(() => {});
      return res.status(401).json({ error: "Código expirado" });
    }
    await prisma.otpVerification.delete({ where: { phone: shopOtpKey } }).catch(() => {});
    const inputDigits = digitsOnly(normalized);
    const shops = await prisma.shop.findMany({ where: { phone: { not: null } } });
    const shop = shops.find((s) => s.phone && digitsOnly(s.phone) === inputDigits);
    if (!shop) {
      return res.status(400).json({ error: "Tienda no encontrada" });
    }
    const token = signShopAccessToken({ sub: shop.id, email: shop.name });
    const refreshToken = signShopRefreshToken({ sub: shop.id, email: shop.name });
    return res.json({
      token,
      refreshToken,
      shop: {
        id: shop.id,
        name: shop.name,
        type: shop.type,
        phone: shop.phone ?? undefined,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al verificar el código" });
  }
});

// Ewe-Shop: exchange refresh JWT for new access + refresh (rotation).
authRouter.post("/shop/refresh", async (req, res) => {
  try {
    const raw = req.body?.refreshToken;
    const refreshToken = typeof raw === "string" ? raw.trim() : "";
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken es requerido" });
    }
    const payload = verifyShopRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: "Sesión expirada" });
    }
    const shop = await prisma.shop.findUnique({ where: { id: payload.sub } });
    if (!shop) {
      return res.status(401).json({ error: "Sesión inválida" });
    }
    const token = signShopAccessToken({ sub: shop.id, email: shop.name });
    const newRefresh = signShopRefreshToken({ sub: shop.id, email: shop.name });
    return res.json({ token, refreshToken: newRefresh });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al renovar la sesión" });
  }
});

authRouter.post("/request-otp", async (req, res) => {
  try {
    const { phone } = req.body || {};
    const normalized = typeof phone === "string" ? phone.trim() : "";
    if (!normalized) {
      return res.status(400).json({ error: "Phone is required" });
    }
    const userExists = !!(await prisma.user.findFirst({ where: { phone: normalized } }));
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
    await prisma.otpVerification.upsert({
      where: { phone: normalized },
      create: { phone: normalized, code, expiresAt },
      update: { code, expiresAt },
    });
    // In development, log OTP to console (remove in production or use SMS provider)
    console.log(`[OTP] ${normalized} => ${code} (expires in ${OTP_EXPIRES_MINUTES} min)`);
    return res.json({ user_exists: userExists });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to send code" });
  }
});

authRouter.post("/verify-otp", async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    const normalized = typeof phone === "string" ? phone.trim() : "";
    const codeStr = typeof code === "string" ? code.trim() : "";
    if (!normalized || !codeStr) {
      return res.status(400).json({ error: "Phone and code are required" });
    }
    const otp = await prisma.otpVerification.findUnique({ where: { phone: normalized } });
    if (!otp || otp.code !== codeStr) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }
    if (new Date() > otp.expiresAt) {
      await prisma.otpVerification.delete({ where: { phone: normalized } }).catch(() => {});
      return res.status(401).json({ error: "Code expired" });
    }
    await prisma.otpVerification.delete({ where: { phone: normalized } }).catch(() => {});
    const inputDigits = digitsOnly(normalized);
    const usersWithPhone = await prisma.user.findMany({ where: { phone: { not: null } } });
    const user = inputDigits ? usersWithPhone.find((u) => u.phone && digitsOnly(u.phone) === inputDigits) : null;
    if (user) {
      const email = user.email ?? "";
      const token = signUserAccessToken({
        sub: user.id,
        email,
        role: user.role,
      });
      const refreshToken = signUserRefreshToken({
        sub: user.id,
        email,
        role: user.role,
      });
      return res.json({
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email ?? undefined,
          phone: user.phone ?? undefined,
          name: user.name ?? undefined,
          last_name: user.lastName ?? undefined,
        },
        requires_registration: false,
      });
    }
    return res.json({ requires_registration: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Invalid code" });
  }
});

authRouter.post("/refresh", async (req, res) => {
  try {
    const raw = req.body?.refreshToken;
    const refreshToken = typeof raw === "string" ? raw.trim() : "";
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken es requerido" });
    }
    const payload = verifyConsumerAppRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: "Sesión expirada" });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ error: "Sesión inválida" });
    }
    const email = user.email ?? "";
    const token = signUserAccessToken({ sub: user.id, email, role: user.role });
    const newRefresh = signUserRefreshToken({ sub: user.id, email, role: user.role });
    return res.json({ token, refreshToken: newRefresh });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al renovar la sesión" });
  }
});

// --- Delivery app (Ewe-Man): OTP login by DeliveryMan celphone ---
const DELIVERY_OTP_PREFIX = "delivery:";

authRouter.post("/delivery/request-otp", async (req, res) => {
  try {
    const { phone } = req.body || {};
    const normalized = typeof phone === "string" ? phone.trim() : "";
    if (!normalized) {
      return res.status(400).json({ error: "El número de teléfono es requerido" });
    }
    const inputDigits = digitsOnly(normalized);
    if (!inputDigits.length) {
      return res.status(400).json({ error: "El número de teléfono no es válido" });
    }
    const deliveryMen = await prisma.deliveryMan.findMany({ where: { celphone: { not: null } } });
    const deliveryMan = deliveryMen.find((d) => d.celphone && digitsOnly(d.celphone) === inputDigits);
    if (!deliveryMan) {
      return res.status(400).json({ error: "Número no registrado. Registra al repartidor en el panel web." });
    }
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
    const deliveryOtpKey = DELIVERY_OTP_PREFIX + normalized;
    await prisma.otpVerification.upsert({
      where: { phone: deliveryOtpKey },
      create: { phone: deliveryOtpKey, code, expiresAt },
      update: { code, expiresAt },
    });
    console.log(`[OTP Delivery] ${normalized} => ${code} (expires in ${OTP_EXPIRES_MINUTES} min)`);
    return res.json({ sent: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al enviar el código" });
  }
});

authRouter.post("/delivery/verify-otp", async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    const normalized = typeof phone === "string" ? phone.trim() : "";
    const codeStr = typeof code === "string" ? code.trim() : "";
    if (!normalized || !codeStr) {
      return res.status(400).json({ error: "Teléfono y código son requeridos" });
    }
    const deliveryOtpKey = DELIVERY_OTP_PREFIX + normalized;
    const otp = await prisma.otpVerification.findUnique({ where: { phone: deliveryOtpKey } });
    if (!otp || otp.code !== codeStr) {
      return res.status(401).json({ error: "Código inválido o expirado" });
    }
    if (new Date() > otp.expiresAt) {
      await prisma.otpVerification.delete({ where: { phone: deliveryOtpKey } }).catch(() => {});
      return res.status(401).json({ error: "Código expirado" });
    }
    await prisma.otpVerification.delete({ where: { phone: deliveryOtpKey } }).catch(() => {});
    const inputDigits = digitsOnly(normalized);
    const deliveryMen = await prisma.deliveryMan.findMany({ where: { celphone: { not: null } } });
    const deliveryMan = deliveryMen.find((d) => d.celphone && digitsOnly(d.celphone) === inputDigits);
    if (!deliveryMan) {
      return res.status(400).json({ error: "Repartidor no encontrado" });
    }
    const token = signDeliveryAccessToken({
      sub: deliveryMan.id,
      email: deliveryMan.name || "",
    });
    const refreshToken = signDeliveryRefreshToken({
      sub: deliveryMan.id,
      email: deliveryMan.name || "",
    });
    return res.json({
      token,
      refreshToken,
      deliveryMan: {
        id: deliveryMan.id,
        name: deliveryMan.name,
        celphone: deliveryMan.celphone ?? undefined,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al verificar el código" });
  }
});

authRouter.post("/delivery/refresh", async (req, res) => {
  try {
    const raw = req.body?.refreshToken;
    const refreshToken = typeof raw === "string" ? raw.trim() : "";
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken es requerido" });
    }
    const payload = verifyDeliveryRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: "Sesión expirada" });
    }
    const deliveryMan = await prisma.deliveryMan.findUnique({ where: { id: payload.sub } });
    if (!deliveryMan) {
      return res.status(401).json({ error: "Sesión inválida" });
    }
    const name = deliveryMan.name || "";
    const token = signDeliveryAccessToken({ sub: deliveryMan.id, email: name });
    const newRefresh = signDeliveryRefreshToken({ sub: deliveryMan.id, email: name });
    return res.json({ token, refreshToken: newRefresh });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al renovar la sesión" });
  }
});

authRouter.post("/complete-registration", async (req, res) => {
  try {
    const { phone, name, last_name, email } = req.body || {};
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    const nameStr = typeof name === "string" ? name.trim() : "";
    const lastNameStr = typeof last_name === "string" ? last_name.trim() : "";
    const emailStr = typeof email === "string" ? email.trim() : "";
    if (!normalizedPhone || !nameStr || !lastNameStr || !emailStr) {
      return res.status(400).json({ error: "Phone, name, last name and email are required" });
    }
    const existingByPhone = await prisma.user.findFirst({ where: { phone: normalizedPhone } });
    if (existingByPhone) {
      return res.status(400).json({ error: "User already exists for this phone" });
    }
    const existingByEmail = await prisma.user.findUnique({ where: { email: emailStr } });
    if (existingByEmail) {
      return res.status(400).json({ error: "Email already registered" });
    }
    const passwordHash = await hashPassword(crypto.randomUUID());
    const user = await prisma.user.create({
      data: {
        email: emailStr,
        phone: normalizedPhone,
        name: nameStr,
        lastName: lastNameStr,
        passwordHash,
        role: "USER",
      },
    });
    const userEmail = user.email ?? "";
    const token = signUserAccessToken({
      sub: user.id,
      email: userEmail,
      role: user.role,
    });
    const refreshToken = signUserRefreshToken({
      sub: user.id,
      email: userEmail,
      role: user.role,
    });
    return res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
        name: user.name ?? undefined,
        last_name: user.lastName ?? undefined,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Registration failed" });
  }
});
