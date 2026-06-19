// sw.js — service worker mínimo: app-shell cache + passthrough + push.
const CACHE = 'bisa-v10';
const SHELL = ['/', '/style.css', '/app.js',
  '/screens/hub.js', '/screens/journal.js', '/screens/world.js', '/screens/chat.js',
  '/vendor/marked.min.js', '/vendor/purify.min.js', '/vendor/Sortable.min.js', '/vendor/force-graph.min.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // network-first para API/WS; cache-first para o shell estático
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') ||
      url.pathname.match(/^\/(codex|planner|pkm|finance|llm|push|pair|feedback|sentinel|file|fs|auth-check|healthz)/)) {
    return; // deixa passar direto à rede
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
self.addEventListener('push', (e) => {
  let d = { title: 'bisa', body: '' };
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'bisa', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: d.tag, data: d.url || '/' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data || '/'));
});
