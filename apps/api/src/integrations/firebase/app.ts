import { type App, applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { env } from "../../config/env";

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
