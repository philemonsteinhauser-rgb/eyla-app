/* eslint-env serviceworker */
// EYLA Service Worker — handelt Push-Notifications.
// Registriert per navigator.serviceWorker.register("/sw.js") aus dem Frontend.

self.addEventListener("install", (event) => {
  // Sofort aktivieren, alte SW skippen
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push-Event: Backend sendet via web-push, hier wird Notification gezeigt
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "EYLA", body: event.data?.text() || "" };
  }
  const title = data.title || "EYLA";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "eyla-reminder",
    renotify: false,
    data: { url: data.url || "/" },
    vibrate: [60, 30, 60],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click auf Notification: App öffnen oder fokussieren
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Wenn ein Window schon offen ist: fokussieren
    for (const w of wins) {
      if (w.url.includes(self.location.origin)) {
        w.focus();
        if (w.navigate) try { await w.navigate(url); } catch {}
        return;
      }
    }
    // Sonst neu öffnen
    await self.clients.openWindow(url);
  })());
});
