import type { PushDevice, PushDevicesResponse, PushProviderName } from "@leadanchor/contracts";
import { api } from "./api";

/**
 * Phone alerts in the browser (C-05). The service worker (public/sw.js) shows every
 * alert, whether it arrives through Firebase Cloud Messaging or, until Firebase is
 * connected, over the app's live connection (showSimulatedAlert).
 */

/** What this browser can do: alerts need https (or localhost), and iPhones need the Home Screen app. */
export type AlertSupport = "ready" | "insecure" | "install_first" | "unsupported";

/** An alert the API sent while Firebase is simulated. */
export interface SimulatedAlert {
  tokens: string[];
  title: string;
  body: string;
  link: string;
  callbackPhone: string | null;
  tag: string | null;
  sentAt: string;
}

const DEVICE_KEY = "leadanchor.alert-device";

export function alertSupport(): AlertSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (apple && !window.matchMedia("(display-mode: standalone)").matches) return "install_first";
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return "unsupported";
  return "ready";
}

/** The device row this browser registered, remembered so it can tell itself apart. */
export function savedDevice(): { id: string; token: string } | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as { id: string; token: string }) : null;
  } catch {
    return null;
  }
}

function saveDevice(device: { id: string; token: string } | null) {
  try {
    if (device) localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Private browsing: alerts still work this session; the browser just won't remember it.
  }
}

/** Asks for permission, starts the service worker and registers this browser for alerts. */
export async function turnOnAlerts(
  provider: PushProviderName,
  firebase: PushDevicesResponse["firebase"],
): Promise<PushDevice> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "blocked" : "dismissed");
  await navigator.serviceWorker.register("/sw.js");
  // With Firebase, the browser's push token comes from Firebase; the simulator issues its own.
  const token = provider === "fcm" ? await firebaseToken(firebase) : savedDevice()?.token;
  const device = await api<PushDevice>("/push/devices", { method: "POST", body: { token, label: deviceLabel() } });
  saveDevice({ id: device.id, token: device.token });
  return device;
}

/**
 * This browser's Firebase Cloud Messaging token, tied to our own service worker (public/sw.js),
 * which shows the alerts. Firebase's code loads only when someone turns alerts on.
 */
async function firebaseToken(config: PushDevicesResponse["firebase"]): Promise<string> {
  if (!config) throw new Error("firebase_web_not_configured");
  const [{ getApps, initializeApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await isSupported())) throw new Error("firebase_unsupported");
  const { vapidKey, ...settings } = config;
  const app = getApps().find((existing) => existing.name === "leadanchor") ?? initializeApp(settings, "leadanchor");
  // getToken still works with the server's token-based sends (Firebase now also offers register()).
  return getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready });
}

export async function turnOffAlerts(deviceId: string) {
  await api(`/push/devices/${deviceId}`, { method: "DELETE" });
  if (savedDevice()?.id === deviceId) saveDevice(null);
}

/** Shows an alert meant for this browser. Returns how long it took to arrive, or null if it wasn't for us. */
export async function showSimulatedAlert(alert: SimulatedAlert): Promise<number | null> {
  const device = savedDevice();
  if (!device || !alert.tokens.includes(device.token)) return null;
  if (!("Notification" in window) || Notification.permission !== "granted") return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) return null;
  registration.active.postMessage({
    type: "show-alert",
    alert: { title: alert.title, body: alert.body, link: alert.link, callbackPhone: alert.callbackPhone, tag: alert.tag },
  });
  return Date.now() - Date.parse(alert.sentAt);
}

/** "Chrome on Android", so the owner can tell their phones apart. */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const system = /Android/.test(ua)
    ? "Android"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "this device";
  return `${browser} on ${system}`;
}
