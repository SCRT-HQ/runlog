import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envConfig } from "../lib/config";
import { headTags, injectHead, licensesPage, ogImage, overlay, substitute, wordsFor } from "../../scripts/overlay";

/**
 * The hosted layer is a build step, so its failure mode is a quiet one: a
 * `{{PLACEHOLDER}}` shipped as text, a shell without its tags, a page that
 * names the wrong environment. These pin the words to the environment and
 * the step to the files it must leave behind.
 */

const build = { version: "0.2.0", sha: "abcdef123456", today: new Date("2026-09-06T12:00:00Z") };

describe("the words", () => {
  it("come from the stage's configuration", () => {
    const words = wordsFor(envConfig("prd"), build);
    expect(words["DOMAIN"]).toBe("runlog.example.com");
    expect(words["OPERATOR"]).toBe("Example Co, LLC");
    expect(words["OPERATOR_SHORT"]).toBe("Example Co");
    expect(words["SUPPORT"]).toContain("@");
    expect(words["YEAR"]).toBe("2026");
    expect(words["DATE"]).toBe("2026-09-06");
    expect(words["EXPIRES"]).toMatch(/^2027-09-06/);
    expect(words["BILLING"]).toBe("false");
    expect(words["SIGN_IN"]).toMatch(/^client_/);
  });

  it("fill every placeholder, and refuse one they do not know", () => {
    expect(substitute("at {{DOMAIN}} by {{OPERATOR}}", { DOMAIN: "x", OPERATOR: "y" })).toBe("at x by y");
    expect(() => substitute("{{NOPE}}", {})).toThrow(/NOPE/);
  });
});

describe("the shell", () => {
  const tags = headTags({ DOMAIN: "runlog.example", VERSION: "1.0.0", SHA: "abc" });
  it("gets its tags at the marker", () => {
    const html = injectHead("<html><head><title>x</title>\n    <!-- hosted:head -->\n</head></html>", tags);
    expect(html).toContain('<meta property="og:image" content="https://runlog.example/og.png" />');
    expect(html).toContain('<link rel="canonical" href="https://runlog.example/" />');
    expect(html).not.toContain("hosted:head");
  });
  it("names the sign-in client for a build that has none, and only a client id", () => {
    expect(headTags({ DOMAIN: "runlog.example", VERSION: "1.0.0", SHA: "abc", SIGN_IN: "client_01ABC" })).toContain(
      '<meta name="runlog:sign-in" content="client_01ABC" />',
    );
    expect(tags).not.toContain("runlog:sign-in");
  });

  it("gets them before </head> when the app has no marker", () => {
    const html = injectHead("<html><head><title>x</title></head></html>", tags);
    expect(html.indexOf("og:title")).toBeLessThan(html.indexOf("</head>"));
  });
});

describe("the image", () => {
  it("is a PNG of the size the tags promise", () => {
    const png = ogImage();
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe("laid over a build", () => {
  it("leaves every hosted file behind, filled in, and stamps the shell", () => {
    const root = mkdtempSync(join(tmpdir(), "runlog-overlay-"));
    const dist = join(root, "dist");
    const app = join(root, "app");
    mkdirSync(dist, { recursive: true });
    mkdirSync(join(app, "apps", "web"), { recursive: true });
    mkdirSync(join(app, "node_modules", "react"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<html><head><title>Runlog</title>\n<!-- hosted:head -->\n</head><body></body></html>");
    writeFileSync(join(app, "apps", "web", "package.json"), JSON.stringify({ version: "0.3.0" }));
    writeFileSync(
      join(app, "package-lock.json"),
      JSON.stringify({
        packages: {
          "": { name: "runlog" },
          "node_modules/react": { version: "19.0.0", license: "MIT" },
          "node_modules/vitest": { version: "3.0.0", dev: true, license: "MIT" },
        },
      }),
    );
    writeFileSync(join(app, "node_modules", "react", "package.json"), JSON.stringify({ license: "MIT" }));
    writeFileSync(join(app, "node_modules", "react", "LICENSE"), "MIT License\nCopyright (c) Meta");

    const files = overlay({ dist, appRoot: app, env: "dev", sha: "0123456789abcdef", today: build.today });

    for (const f of ["hosted.json", "hosted.css", "legal/terms.html", "legal/privacy.html", "legal/publishers.html", "pricing.html", "about.html", "licenses.html", "og.png", "robots.txt", "sitemap.xml", ".well-known/security.txt", "index.html"]) {
      expect(files).toContain(f);
    }
    const hosted = JSON.parse(readFileSync(join(dist, "hosted.json"), "utf8")) as { operator: string; legalName: string; links: Record<string, string>; termsVersion: string; sha: string; features: { billing: boolean } };
    expect(hosted.links["terms"]).toBe("https://runlog.example.com/legal/terms.html");
    expect(hosted.termsVersion).toBe(envConfig("dev").hosted.termsVersion);
    expect(hosted.sha).toBe("0123456789ab");
    expect(hosted.features.billing).toBe(false);
    // The app's footer says the short name; the terms gate names the LLC.
    expect(hosted.operator).toBe("Example Co");
    expect(hosted.legalName).toBe("Example Co, LLC");
    expect(readFileSync(join(dist, "legal", "terms.html"), "utf8")).toContain("between you and Example Co, LLC");
    expect(readFileSync(join(dist, "about.html"), "utf8")).toMatch(/run by\s+Example Co, with/);

    for (const f of files.filter((f) => f !== "og.png")) {
      expect(readFileSync(join(dist, f), "utf8"), f).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
    expect(readFileSync(join(dist, "index.html"), "utf8")).toContain("og:image");
    const licenses = readFileSync(join(dist, "licenses.html"), "utf8");
    expect(licenses).toContain("react");
    expect(licenses).toContain("Copyright (c) Meta");
    expect(licenses).not.toContain("vitest");
  });

  it("lays over a published build as well: the package's version, the notice it ships, and the sign-in client in the shell", () => {
    const root = mkdtempSync(join(tmpdir(), "runlog-overlay-pkg-"));
    const pkg = join(root, "package");
    const dist = join(pkg, "app");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<html><head><title>Runlog</title>\n<!-- hosted:head -->\n</head><body></body></html>");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@scrthq/runlog", version: "0.4.0" }));
    writeFileSync(join(pkg, "licenses.json"), JSON.stringify([{ name: "react", version: "19.0.0", license: "MIT" }]));

    const files = overlay({ dist, appRoot: pkg, env: "prd", sha: "0.4.0", today: build.today });

    expect(files).toContain("index.html");
    const shell = readFileSync(join(dist, "index.html"), "utf8");
    expect(shell).toContain(`<meta name="runlog:sign-in" content="${envConfig("prd").workosClientId}" />`);
    expect(shell).toContain('<meta name="runlog:build" content="0.4.0 0.4.0" />');
    expect(readFileSync(join(dist, "licenses.html"), "utf8")).toContain("<strong>react</strong>");
    expect((JSON.parse(readFileSync(join(dist, "hosted.json"), "utf8")) as { version: string }).version).toBe("0.4.0");
  });

  it("writes the licenses page from what it is given", () => {
    const page = licensesPage([{ name: "left-pad", version: "1.0.0", license: "WTFPL" }], { DOMAIN: "d", YEAR: "2026", VERSION: "1", SHA: "s", OPERATOR: "o" });
    expect(page).toContain("left-pad");
    expect(page).toContain("WTFPL");
  });
});
