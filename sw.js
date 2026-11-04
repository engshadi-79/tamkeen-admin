/* عامل الخدمة: يخزّن ملفات الأداة نفسها حتى تفتح بسرعة وعند ضعف الإنترنت.
   البيانات لا تُخزَّن هنا؛ فهي في المتصفح وفي خادم المركز. */
const CACHE = "tamkeen-shell-v194";
const SHELL = [
  "./",
  "./index.html",
  "./styles/theme.css",
  "./styles/executive.css",
  "./styles/center.css",
  "./manifest.webmanifest",
  "./assets/letterhead/page.jpg",
  "./assets/logo.png",
  "./assets/logo-white.png",
  "./assets/icon-192.png",
  "./vendor/jszip.min.js",
  "./vendor/exceljs.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/* طلبات الأداة فقط: الشبكة أولاً ثم النسخة المخزّنة؛ وطلبات الخادم لا تُخزَّن إطلاقاً */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
