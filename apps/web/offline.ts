import type { Plugin } from "vite";

/**
 * Making the app work with the network off.
 *
 * The usual answer here is `vite-plugin-pwa`, which brings Workbox with it.
 * Workbox exists to solve caching problems this app does not have: there is no
 * API, no user content coming down the wire, no runtime fetching of anything.
 * The whole app is one HTML file, one script and one stylesheet, and it is
 * already built to run from a `file://` URL. Precaching three known filenames
 * is about thirty lines, and thirty lines is cheaper to keep honest than a
 * dependency tree — the same call already made for storage.
 *
 * The worker is generated rather than written by hand because the built
 * filenames carry content hashes: a hand-written list would go stale on the
 * next build and silently serve last week's app forever, which is the classic
 * way to ship a broken offline mode.
 */

/** Bumped by the worker's own contents, so a new build is a new cache. */
const CACHE_PREFIX = "runlog-";

/** Small non-cryptographic hash; this names a cache, it does not secure one. */
function hash(text: string): string {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function workerSource(version: string, assets: string[]): string {
  return `// Generated at build time. Do not edit.
const CACHE = ${JSON.stringify(CACHE_PREFIX + version)};
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener("install", (event) => {
  // The new worker takes over as soon as it is ready. The alternative is a
  // player who reloads after an update and still sees the old app, with no
  // way to tell why.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const absolute = (path) => new URL(path, self.location.href).href;

/**
 * Find a precached file.
 *
 * The exact-match lookup is tried first and is usually enough, but it cannot
 * be relied on alone: entries were stored from plain URL strings, while the
 * browser asks for a module script or a stylesheet with a request of its own
 * shaping. Those can miss on an exact match with the file sitting right there
 * in the cache — which looks, from the page, like the app simply not loading.
 * So a miss falls back to looking the URL up directly.
 */
async function cached(request) {
  return (
    (await caches.match(request)) ??
    (await caches.match(request.url, { ignoreVary: true }))
  );
}

async function handle(request) {
  // A navigation prefers the network, so a running server always wins and an
  // update is never a reload behind. Offline it falls back to the shell,
  // rather than to the browser's dinosaur.
  if (request.mode === "navigate") {
    try {
      return await fetch(request);
    } catch {
      const shell = await caches.match(absolute("./index.html"), { ignoreVary: true });
      return shell ?? new Response("Offline, and the app was never cached.", { status: 504 });
    }
  }

  // Cache first for everything else: these files are content-hashed, so a
  // cached copy is never a stale copy — it is the file that name means.
  const hit = await cached(request);
  if (hit) return hit;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      const cache = await caches.open(CACHE);
      await cache.put(request, copy);
    }
    return response;
  } catch {
    // Offline and genuinely not held. This must resolve to *something*: a
    // rejected respondWith surfaces as a bare network error with no way to
    // tell what failed, which is exactly how a missing script became a blank
    // page and an empty console.
    return new Response("", { status: 504, statusText: "offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API is per-person and never cacheable. A cached manifest would be a
  // sync that silently never happens, so the worker stays out of /api/ —
  // wherever that is: the app may be served from a path, so the check is
  // relative to the worker's own scope rather than to the origin's root.
  if (url.href.startsWith(absolute("./api/"))) return;
  // The hosted layer beside the shell — hosted.json, the legal pages, what
  // crawlers ask for — is the operator's and changes with a publish; the
  // app asks for hosted.json with the cache off, and the pages are read,
  // not run, so none of it is held here.
  if (url.href === absolute("./hosted.json") || url.href.startsWith(absolute("./legal/")) || url.href.startsWith(absolute("./.well-known/"))) return;

  event.respondWith(handle(request));
});
`;
}

export function offline(): Plugin {
  return {
    name: "runlog-offline",
    apply: "build",
    generateBundle(_options, bundle) {
      // Files copied straight from `public/` never enter the bundle, so they
      // are named here rather than discovered below.
      const assets = ["./index.html", "./manifest.webmanifest", "./icon.svg"];
      for (const file of Object.values(bundle)) {
        if (file.fileName.endsWith(".map")) continue;
        assets.push(`./${file.fileName}`);
      }

      // The version is a hash of the worker itself, which covers both the
      // built filenames it precaches *and* the caching logic around them.
      // Hashing only the filenames would let a fix to this file ship against
      // a cache the old code had filled — the subtler half of the same trap
      // a hand-written asset list falls into.
      const version = hash(workerSource("", assets));

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: workerSource(version, assets),
      });
    },
  };
}
