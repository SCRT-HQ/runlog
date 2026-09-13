import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listingPayload } from "../packages/rules-schema/src/index.ts";

/**
 * The built-in packs, listed in the catalog as the platform's own.
 *
 * The catalog's feed carries everything, the built-ins too, so a card
 * looks the same whoever published it. This uploads each shipped pack to
 * the platform publisher and lists it free; the head and the summary are
 * computed here exactly as the app would. Idempotent: an upload replaces
 * the master and refreshes the card; nothing is made twice.
 *
 * It also takes down what this list no longer names. Seeding only ever
 * added, so a pack removed from the repository went on being offered for
 * as long as the shelf existed: thirteen of them were still listed in
 * production after they had stopped shipping. So the list below is the
 * whole truth about what is listed, and anything else the platform
 * publisher has on the shelf comes off on the next deploy.
 *
 * Taken down, not deleted: the card leaves the shelf and the product goes
 * back to draft, so the master is kept and re-listing restores it. Anyone
 * who already has one of these keeps it, since a pack lives in a library
 * on their own device; what stops is being offered it again.
 *
 *   RUNLOG_API=https://runlog.dev.scrthq.com/api RUNLOG_API_KEY=rl_… \
 *     node --experimental-strip-types scripts/seed-listings.ts
 *
 * Without a key it says so and does nothing, so a deploy without one is
 * a deploy without seeding rather than a failure.
 */

const PACKS = [
  "packs/sketches/ladder-work.yaml",
  "packs/sketches/rocket-league-ladder.yaml",
  "packs/sketches/practice-room.yaml",
  "packs/sketches/elden-ring-tarnishedtool.yaml",
  "packs/sketches/rocket-league-showdown.yaml",
  "packs/sketches/twenty-five.yaml",
  "packs/sketches/run-of-show.yaml",
  "packs/sketches/forfeits.yaml",
  // packs/demo and packs/testing are deliberately absent from this list.
  // The bench is a bench; the demo pack is the worked example the guide
  // and the suite are written against. Both keep loading and neither is
  // something to offer a player.
];

const api = (process.env["RUNLOG_API"] ?? "").replace(/\/$/, "");
const key = process.env["RUNLOG_API_KEY"] ?? "";
if (!api || !key) {
  console.log("seed-listings: RUNLOG_API or RUNLOG_API_KEY is not set; nothing seeded");
  process.exit(0);
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${method} ${path}: the API did not answer as expected (${response.status})`);
  }
  return { status: response.status, body: parsed };
}

async function main() {
  const me = await call("GET", "/publishers/me");
  if (!me.body["publisher"]) {
    console.error("seed-listings: this key's account is not a publisher; become one on the profile page first");
    process.exit(1);
  }
  let failed = 0;
  /**
   * Every pack this list names, recorded the moment its id is known rather
   * than once it has uploaded. A pack that fails to upload is still a pack
   * this repository ships, and must not be mistaken below for one that was
   * removed and taken off the shelf on the strength of a timeout.
   */
  const ours = new Set<string>();
  for (const file of PACKS) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const raw = (await import("yaml")).default.parse(source) as Record<string, unknown>;
    const listing = listingPayload(source, "yaml", raw);
    if (!listing.ok) {
      console.error(`${file}: ${listing.error}`);
      failed += 1;
      continue;
    }
    const { pack, payload } = listing;
    ours.add(pack.id);
    const put = await call("PUT", `/publishers/packs/${encodeURIComponent(pack.id)}`, payload);
    if (put.status !== 200) {
      console.error(`${pack.id}: upload failed (${put.status}) ${String(put.body["error"] ?? "")}`);
      failed += 1;
      continue;
    }
    const listed = await call("POST", `/publishers/packs/${encodeURIComponent(pack.id)}/listing`, {});
    if (listed.status !== 200) {
      console.error(`${pack.id}: listing failed (${listed.status}) ${String(listed.body["error"] ?? "")}`);
      failed += 1;
      continue;
    }
    console.log(`${pack.id} v${pack.version}: listed free`);
  }

  // Anything else the platform publisher has on the shelf stopped shipping,
  // so it stops being offered. Not attempted at all after a failure above:
  // a run that could not say what it ships is not one to trust about what
  // it does not.
  if (failed > 0) {
    console.error("seed-listings: something failed above, so nothing is being taken down");
    process.exit(1);
  }
  const theirs = await call("GET", "/publishers/packs");
  const products = Array.isArray(theirs.body["packs"]) ? (theirs.body["packs"] as Array<Record<string, unknown>>) : [];
  const stale = products.filter((p) => p["status"] === "listed" && typeof p["packId"] === "string" && !ours.has(p["packId"] as string));
  for (const p of stale) {
    const id = p["packId"] as string;
    const down = await call("DELETE", `/publishers/packs/${encodeURIComponent(id)}/listing`);
    if (down.status !== 200) {
      console.error(`${id}: taking the listing down failed (${down.status}) ${String(down.body["error"] ?? "")}`);
      failed += 1;
      continue;
    }
    console.log(`${id}: off the shelf, master kept`);
  }
  if (stale.length === 0) console.log("nothing to take down");

  process.exit(failed > 0 ? 1 : 0);
}

void main();
