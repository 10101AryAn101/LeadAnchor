import { type App, applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { env } from "../../config/env";

/**
 * What a browser needs to sign up for alerts through Firebase (C-05). These identify the web app
 * and are public by design (every browser that gets alerts sees them); the service-account file
 * in GOOGLE_APPLICATION_CREDENTIALS is the secret, and stays on the server.
 */
export function firebaseWebConfig() {
  const apiKey = env.FIREBASE_WEB_API_KEY;
  const appId = env.FIREBASE_WEB_APP_ID;
  const messagingSenderId = env.FIREBASE_MESSAGING_SENDER_ID;
  const vapidKey = env.FIREBASE_VAPID_KEY;
  if (!env.FCM_ENABLED || !apiKey || !appId || !messagingSenderId || !vapidKey) return null;
  return { apiKey, projectId: env.FIREBASE_PROJECT_ID, messagingSenderId, appId, vapidKey };
}

/**
 * Shared Firebase Admin app (spec: FCM push for C-05, Firebase consent ledger for C-27).
 * With FIRESTORE_EMULATOR_HOST set and a "demo-" project id, no Google credentials are needed.
 */
export function firebaseApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    projectId: env.FIREBASE_PROJECT_ID,
    ...(env.GOOGLE_APPLICATION_CREDENTIALS ? { credential: applicationDefault() } : {}),
  });
}
