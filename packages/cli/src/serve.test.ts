import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appDir, contentType, fileFor, startServer } from "./serve.ts";

const dir = mkdtempSync(join(tmpdir(), "runlog-serve-"));
writeFileSync(join(dir, "index.html"), "<!doctype html><title>Runlog</title>");
mkdirSync(join(dir, "assets"));
writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
writeFileSync(join(dir, "sw.js"), "// worker");

describe("serving the app", () => {
  it("names files by their kind and keeps requests inside the app", () => {
    expect(contentType("a/b.woff2")).toBe("font/woff2");
    expect(contentType("x.unknown")).toBe("application/octet-stream");
    expect(fileFor(dir, "/assets/app.js")).toBe(join(dir, "assets", "app.js"));
    expect(fileFor(dir, "/../secret")).toBeNull();
    expect(fileFor(dir, "/assets/%2e%2e/%2e%2e/secret")).toBeNull();
  });

  it("finds the app where it is told, and says when it is nowhere", () => {
    expect(appDir(dir)).toBe(dir);
    expect(appDir(undefined, { RUNLOG_APP_DIR: dir })).toBe(dir);
    const fallback = appDir(join(dir, "nope"), {});
    expect(fallback === null || fallback.endsWith("dist")).toBe(true); // the workspace's own build when it exists, else nothing
  });

  it("serves files, the page for everything else, and nothing outside", async () => {
    const server = await startServer({ dir, port: 0, host: "127.0.0.1" });
    try {
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("cache-control")).toBe("no-cache");
      const asset = await fetch(`${server.url}assets/app.js`);
      expect(await asset.text()).toBe("console.log(1)");
      expect(asset.headers.get("cache-control")).toContain("max-age");
      const deep = await fetch(`${server.url}widget/clock/01ABC?bg=clear`);
      expect(await deep.text()).toContain("<title>Runlog</title>");
      const worker = await fetch(`${server.url}sw.js`);
      expect(worker.headers.get("cache-control")).toBe("no-cache");
      expect((await fetch(server.url, { method: "POST" })).status).toBe(405);
    } finally {
      server.close();
    }
  });
});

afterAll(() => {
  /* the temp dir is the OS's to sweep */
});
