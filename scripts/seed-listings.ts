import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listingPayload } from "../packages/rules-schema/src/index.ts";

/**
 * The built-in packs, listed in the catalog as the platform's own.
 *
 * The catalog's feed carries everything — the built-ins too — so a card
 * looks the same whoever published it. This uploads each shipped pack to
 * the platform publisher and lists it free; the head and the summary are
 * computed here exactly as the app would. Idempotent: an upload replaces
 * the master and refreshes the card; nothing is made twice.
 *
 *   RUNLOG_API=https://runlog.dev.scrthq.com/api RUNLOG_API_KEY=rl_… \
 *     node --experimental-strip-types scripts/seed-listings.ts
 *
 * Without a key it says so and does nothing, so a deploy without one is
 * a deploy without seeding rather than a failure.
 */

const PACKS = [
  "packs/demo/any-given-day.yaml",
  "packs/demo/pack.yaml",
  "packs/sketches/salt-and-signal.yaml",
  "packs/sketches/ladder-work.yaml",
  "packs/sketches/rocket-league-ladder.yaml",
  "packs/sketches/elden-ring-expedition.yaml",
  "packs/sketches/homefront.yaml",
  "packs/sketches/practice-room.yaml",
  "packs/sketches/pantry-roulette.yaml",
  "packs/sketches/elden-ring-trial.yaml",
  "packs/sketches/rocket-league-showdown.yaml",
  "packs/sketches/twenty-five.yaml",
  "packs/sketches/frog-first.yaml",
  "packs/sketches/two-doors.yaml",
  "packs/sketches/word-count.yaml",
  "packs/sketches/the-backlog.yaml",
  "packs/sketches/sunday-desk.yaml",
  "packs/sketches/run-of-show.yaml",
  // packs/testing/engine-testing.yaml is deliberately absent from this list:
  // a test bench belongs in the bundle a dev copy ships, never in a
  // publisher's listing.
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
  process.exit(failed > 0 ? 1 : 0);
}

void main();
