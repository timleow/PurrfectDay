const SHELL_CACHE = "purrfectday-shell-v1";
const ASSET_CACHE = "purrfectday-assets-v1";
const APP_SHELL = ["/", "/site.webmanifest", "/favicon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("purrfectday-") && name !== SHELL_CACHE && name !== ASSET_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const refreshShell = fetch(request, { cache: "no-cache" }).then(async (response) => {
      if (response.ok && !response.redirected && new URL(response.url).origin === self.location.origin) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put("/", response.clone());
      }
      return response;
    }).catch(() => null);
    event.waitUntil(refreshShell.then(() => undefined));
    event.respondWith((async () => (await caches.match("/")) || (await refreshShell) || Response.error())());
    return;
  }

  const isStaticAsset = ["script", "style", "image", "font"].includes(request.destination)
    || url.pathname === "/site.webmanifest";
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  })());
});
