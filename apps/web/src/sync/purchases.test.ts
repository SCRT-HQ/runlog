import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { generateLicenseKey, seal } from "@runlog/rules-schema";
import type { Purchase } from "./client.ts";
import { keepPurchase, openPurchase } from "./purchases.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const kiln = YAML.parse(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8")) as Record<string, unknown>;
const key = generateLicenseKey();
const purchase: Purchase = { ref: "REF1", packId: String(kiln["id"]), title: String(kiln["title"]), status: "fulfilled", key };

describe("a purchased copy", () => {
  it("opens with its key, and again at a newer version under the same key", async () => {
    const first = await openPurchase(purchase, await seal(kiln, key, { ref: "REF1", title: "The Long Kiln" }));
    expect(first?.pack.version).toBe(kiln["version"]);
    expect(first?.header.ref).toBe("REF1");
    const newer = await openPurchase(purchase, await seal({ ...kiln, version: "9.9.9" }, key, { ref: "REF1" }));
    expect(newer?.pack.version).toBe("9.9.9");
    expect(newer?.text).toContain("version: 9.9.9");
  });

  it("is null without a key, with the wrong key, or for bytes that are not a sealed pack", async () => {
    const bytes = await seal(kiln, key, { ref: "REF1" });
    expect(await openPurchase({ ...purchase, key: undefined }, bytes)).toBeNull();
    expect(await openPurchase({ ...purchase, key: generateLicenseKey() }, bytes)).toBeNull();
    expect(await openPurchase(purchase, new TextEncoder().encode("not a pack"))).toBeNull();
  });

  it("is kept on the shelf as a sealed listing copy with its license", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const licenses: Array<Record<string, unknown>> = [];
    const db = {
      savePack: async (p: Record<string, unknown>) => void saved.push(p),
      saveLicense: async (l: Record<string, unknown>) => void licenses.push(l),
    };
    const id = await keepPurchase(db as never, purchase, await seal(kiln, key, { ref: "REF1", title: "The Long Kiln" }));
    expect(id).toBe(kiln["id"]);
    expect(saved[0]).toMatchObject({ id: kiln["id"], sealed: true, origin: "listing", catalog: { id: kiln["id"], version: kiln["version"] } });
    expect(licenses[0]).toMatchObject({ packId: kiln["id"], key, ref: "REF1", title: "The Long Kiln" });
  });
});
