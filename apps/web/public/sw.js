/*
 * LeadAnchor service worker (C-05): shows the owner's missed-call alerts as phone
 * notifications and opens the right screen when one is tapped. Plain JavaScript,
 * served as-is from /sw.js.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Firebase Cloud Messaging delivers alerts as web push once Firebase is connected. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const notification = payload.notification || {};
  const data = payload.data || {};
  event.waitUntil(
    showAlert({
      title: notification.title || "LeadAnchor",
      body: notification.body || "",
      link: data.link || "/dashboard",
      callbackPhone: data.callbackPhone || null,
      tag: data.tag || null,
    }),
  );
});

/** The app asks for an alert directly while Firebase is simulated. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "show-alert") event.waitUntil(showAlert(event.data.alert));
});

function showAlert(alert) {
  return self.registration.showNotification(alert.title, {
    body: alert.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: alert.tag || undefined,
    renotify: Boolean(alert.tag),
    requireInteraction: true,
    data: { link: alert.link, callbackPhone: alert.callbackPhone },
    actions: alert.callbackPhone ? [{ action: "call", title: "Call back" }] : [],
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (event.action === "call" && data.callbackPhone) {
    event.waitUntil(self.clients.openWindow(`tel:${data.callbackPhone}`));
    return;
  }

  // Links carry the public address; always open the page on the origin this app runs on.
  const target = new URL(data.link || "/dashboard", self.location.origin);
  const url = new URL(target.pathname + target.search, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        try {
          await open.navigate(url);
          return;
        } catch {
          // A tab this worker doesn't control can't be navigated; open a new one instead.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
