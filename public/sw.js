/* Service worker: keeps the app shell so the game opens instantly and shows its own "reconnecting" screen when offline.
   Game traffic is a WebSocket and is never cached. __VERSION__ is replaced by the server, so each release gets a fresh cache. */
const V='tir-__VERSION__',SHELL=['/','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin!==location.origin||u.pathname.startsWith('/admin')||u.pathname==='/health'||u.pathname==='/sw.js'||u.pathname.startsWith('/.well-known'))return;
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put('/',cp))}return res}).catch(()=>caches.match('/')));return}
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok&&u.pathname.startsWith('/icons/')){const cp=res.clone();caches.open(V).then(c=>c.put(r,cp))}return res})))});
