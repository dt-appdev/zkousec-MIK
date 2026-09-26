// Service worker Zkoušeče MIK
//
// Strategie network-first: když je síť, načte se vždy čerstvá verze z GitHub
// Pages a uloží se do cache. Bez sítě (nebo když síť neodpoví do 4 s) se
// použije poslední verze z cache. Úprava v repozitáři se tak na tabletu
// projeví hned při dalším spuštění online.
//
// Při přidání nového souboru ho připiš do seznamu SOUBORY a zvyš číslo v CACHE.

var CACHE = "zkousec-mik-v1";
var SOUBORY = [
  "./",
  "index.html",
  "css/styl.css",
  "js/app.js",
  "otazky_data.txt",
  "manifest.json",
  "ikony/ikona-180.png",
  "ikony/ikona-192.png",
  "ikony/ikona-512.png",
  "ikony/ikona-maskable-512.png"
];
var LIMIT_SITE = 4000;

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SOUBORY); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (klice) {
        return Promise.all(klice
          .filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function zCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (r) {
    if (r) return r;
    if (req.mode === "navigate") return caches.match("index.html");
    return Response.error();
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // ze sítě vždy bez HTTP cache prohlížeče, aby se nová verze neopožďovala
  var zeSite = fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" }))
    .then(function (res) {
      if (res && res.ok) {
        var kopie = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, kopie); });
      }
      return res;
    });

  var casovac = new Promise(function (hotovo, chyba) {
    setTimeout(function () { chyba(new Error("timeout")); }, LIMIT_SITE);
  });

  e.respondWith(
    Promise.race([zeSite, casovac]).catch(function () {
      return zCache(req).then(function (r) {
        // když cache nic nemá, počkám přece jen na síť
        return (r && r.type !== "error") ? r : zeSite;
      });
    })
  );
  // síť nechám doběhnout, i když odpověděla cache, ať se cache obnoví
  e.waitUntil(zeSite.catch(function () {}));
});
