const generation='workdesk-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(generation).then(cache=>cache.addAll(['/','/client.js'])));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});
