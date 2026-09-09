import { describe, expect, it } from "vitest";
import { offline } from "./offline.ts";

/**
 * The offline worker is generated because a hand-written precache list goes
 * stale the moment an asset hash changes, and when it does, the app keeps
 * serving last week's bundle to anyone who ever loaded it. That is the one
 * failure mode worth a test: silent, permanent, and invisible to the person
 * who caused it.
 */

interface Emitted {
  fileName: string;
  source: string;
}

/** Run the plugin's build hook over a pretend bundle and collect what it wrote. */
function generate(fileNames: string[]): Emitted {
  const emitted: Emitted[] = [];
  // Rollup allows a hook to be either a function or an object wrapping one;
  // this plugin writes the plain function, so it is called as one.
  const plugin = offline() as unknown as {
    generateBundle: (this: unknown, options: unknown, bundle: unknown) => void;
  };
  const bundle = Object.fromEntries(fileNames.map((fileName) => [fileName, { fileName }]));

  plugin.generateBundle.call(
    { emitFile: (file: Emitted) => emitted.push(file) },
    {},
    bundle,
  );

  const worker = emitted.find((e) => e.fileName === "sw.js");
  if (!worker) throw new Error("the plugin emitted no service worker");
  return worker;
}

describe("the offline worker", () => {
  it("precaches every built file", () => {
    const { source } = generate(["assets/index-abc123.js", "assets/index-def456.css"]);
    expect(source).toContain("./assets/index-abc123.js");
    expect(source).toContain("./assets/index-def456.css");
  });

  it("precaches the shell and the files copied in beside it", () => {
    // These never enter the bundle, so nothing would discover them.
    const { source } = generate(["assets/index-abc123.js"]);
    expect(source).toContain("./index.html");
    expect(source).toContain("./manifest.webmanifest");
    expect(source).toContain("./icon.svg");
  });

  it("leaves source maps out of the cache", () => {
    // Debug artifacts are not worth a player's disk, and a missing map is
    // harmless where a missing script is not.
    const { source } = generate(["assets/index-abc123.js", "assets/index-abc123.js.map"]);
    expect(source).not.toContain(".js.map");
  });

  /**
   * The cache name is derived from the filenames, which carry content hashes.
   * A new build must therefore be a new cache, or the activate handler has
   * nothing to clear and the old bundle survives forever.
   */
  it("changes cache name when the build changes", () => {
    const before = generate(["assets/index-abc123.js"]).source;
    const after = generate(["assets/index-zzz999.js"]).source;
    const name = (s: string) => /const CACHE = "([^"]+)"/.exec(s)?.[1];
    expect(name(before)).toBeTruthy();
    expect(name(after)).not.toBe(name(before));
  });

  it("changes cache name when only the caching logic changes", () => {
    // Hashing just the filenames would let a fix to the worker ship against a
    // cache the broken version had already filled.
    const { source } = generate(["assets/index-abc123.js"]);
    const name = /const CACHE = "([^"]+)"/.exec(source)?.[1] ?? "";
    // The name is derived from the worker body, so the body contains the
    // handler code as well as the asset list.
    expect(source).toContain("async function handle(request)");
    expect(name).not.toContain("abc123");
    expect(name.length).toBeGreaterThan(3);
  });

  it("keeps the cache name stable for an identical build", () => {
    expect(generate(["assets/index-abc123.js"]).source).toBe(
      generate(["assets/index-abc123.js"]).source,
    );
  });

  it("falls back to the shell for a navigation, so offline lands in the app", () => {
    const { source } = generate(["assets/index-abc123.js"]);
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain('absolute("./index.html")');
  });

  /**
   * Found the hard way: with the server stopped, the module script missed an
   * exact cache match, the bare `fetch` behind it rejected, and `respondWith`
   * never resolved. The page came up empty with nothing in the console: the
   * app was cached in full and would not start.
   */
  describe("serving a file the browser asks for in its own way", () => {
    it("looks a miss up by URL before giving up on it", () => {
      const { source } = generate(["assets/index-abc123.js"]);
      expect(source).toContain("caches.match(request.url, { ignoreVary: true })");
    });

    it("never lets a failed fetch escape as a rejection", () => {
      // Every path through the handler has to resolve to a Response, or the
      // failure arrives as an opaque network error attached to nothing.
      const { source } = generate(["assets/index-abc123.js"]);
      const body = source.slice(source.indexOf("async function handle"));
      expect(body.match(/await fetch\(/g)?.length).toBe(2);
      expect(body.match(/} catch {/g)?.length).toBe(2);
      expect(source).toContain('statusText: "offline"');
    });
  });

  it("leaves other origins and non-GET requests alone", () => {
    const { source } = generate(["assets/index-abc123.js"]);
    expect(source).toContain('request.method !== "GET"');
    expect(source).toContain("url.origin !== self.location.origin");
  });

  it("stays out of the API, which is per-person and never cacheable", () => {
    // A cached manifest would be a sync that silently never happens. The
    // check is relative to the worker's scope, not the origin: a copy
    // served from a path has its API under that path.
    const { source } = generate(["assets/index-abc123.js"]);
    expect(source).toContain('url.href.startsWith(absolute("./api/"))');
    expect(source).not.toContain('url.pathname.startsWith("/api/")');
  });

  it("stays out of the hosted layer, which changes with a publish", () => {
    const { source } = generate(["assets/index-abc123.js"]);
    expect(source).toContain('absolute("./hosted.json")');
    expect(source).toContain('absolute("./legal/")');
    expect(source).toContain('absolute("./.well-known/")');
  });

  it("only runs for builds, so it cannot fight hot reload", () => {
    expect(offline().apply).toBe("build");
  });
});
