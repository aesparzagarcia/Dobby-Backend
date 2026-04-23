import type { OrderStatus } from "@prisma/client";
import admin from "firebase-admin";
import { prisma } from "../lib/db.js";

let firebaseApp: admin.app.App | null = null;
let firebaseInitAttempted = false;

function getFirebaseApp(): admin.app.App | null {
  if (firebaseInitAttempted) return firebaseApp;
  firebaseInitAttempted = true;
  try {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (json?.trim()) {
      const creds = JSON.parse(json) as admin.ServiceAccount;
      firebaseApp = admin.initializeApp({ credential: admin.credential.cert(creds) });
      return firebaseApp;
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      firebaseApp = admin.initializeApp({ credential: admin.credential.applicationDefault() });
      return firebaseApp;
    }
  } catch (e) {
    console.error("[push] Firebase init failed:", e);
  }
  console.warn(
    "[push] FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS not set — push disabled"
  );
  return null;
}

function orderStatusMessage(status: OrderStatus): { title: string; body: string } {
  switch (status) {
    case "PENDING":
      return { title: "Pedido recibido", body: "Tu pedido está pendiente de confirmación." };
    case "CONFIRMED":
      return { title: "Pedido confirmado", body: "La tienda aceptó tu pedido." };
    case "PREPARING":
      return { title: "En preparación", body: "Tu pedido se está preparando." };
    case "READY_FOR_PICKUP":
      return { title: "Listo para envío", body: "Tu pedido está listo para salir." };
    case "ASSIGNED":
      return { title: "Repartidor asignado", body: "Ya hay un repartidor para tu pedido." };
    case "ON_DELIVERY":
      return { title: "En camino", body: "Tu pedido va rumbo a tu domicilio." };
    case "DELIVERED":
      return { title: "Entregado", body: "Tu pedido fue entregado." };
    case "CANCELLED":
      return { title: "Pedido cancelado", body: "Tu pedido fue cancelado." };
    default:
      return { title: "Actualización de pedido", body: `Estado: ${status}` };
  }
}

/**
 * Sends FCM data+notification to all devices registered for the consumer user.
 * No-op if Firebase is not configured or user has no tokens.
 */
export async function notifyConsumerOrderStatusIfConfigured(
  userId: string,
  orderId: string,
  status: OrderStatus
): Promise<void> {
  const app = getFirebaseApp();
  if (!app) return;

  const rows = await prisma.userPushDevice.findMany({
    where: { userId },
    select: { token: true },
  });
  if (!rows.length) return;

  const { title, body } = orderStatusMessage(status);
  const data: Record<string, string> = {
    type: "order_status",
    order_id: orderId,
    status,
  };

  const messaging = admin.messaging(app);
  const tokens = rows.map((r) => r.token);
  const resp = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
    android: { priority: "high" },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  });

  const deadTokens: string[] = [];
  resp.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      deadTokens.push(tokens[i]);
    }
  });
  if (deadTokens.length) {
    await prisma.userPushDevice.deleteMany({ where: { token: { in: deadTokens } } });
  }
}
