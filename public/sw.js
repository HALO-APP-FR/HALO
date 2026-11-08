/* HALO — service worker des notifications push (migration 28). Aucune mise en cache : uniquement l'affichage
   des notifications et l'ouverture de la bonne page. Le contenu reçu est neutre (catégorie + logement). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "HALO";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      renotify: Boolean(data.urgent),
      requireInteraction: Boolean(data.urgent),
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/";
  try {
    const u = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin);
    // Jamais d'ouverture vers un autre site
    target = u.origin === self.location.origin ? u.href : "/";
  } catch {
    target = "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
