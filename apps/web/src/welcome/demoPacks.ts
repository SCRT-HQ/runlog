import { loadPackText, type Pack } from "@runlog/rules-schema";
import type { PersonaId } from "./personas.ts";

/**
 * The landing page's only packs: five bundled files, named here by hand.
 *
 * Everything else the app reads a pack from, the marketplace's listing/feed
 * precedence, a publisher's storage, a network request, goes through code
 * that can end up serving whatever a publisher shipped this week, or a
 * player's own private run. A demo on the landing page is neither: it is
 * always the same five packs, read straight out of the repository, so the
 * page can never show a stranger's words or a stranger's data. The five
 * `import()` calls below are static and explicit so Vite resolves them at
 * build time into their own bundled chunks; nothing here constructs a path
 * from a variable, so nothing here can be pointed at a different file.
 */

export const DEMO_PACK_IDS: readonly PersonaId[] = ["streamer", "dj", "learner", "elden-lord", "rlcs-champion"];

const sources: Record<PersonaId, { packId: string; load: () => Promise<string> }> = {
  streamer: {
    packId: "com.scrthq.runlog.forfeits",
    load: () => import("../../../../packs/sketches/forfeits.yaml?raw").then((m) => m.default),
  },
  dj: {
    packId: "com.scrthq.runlog.soundclash",
    load: () => import("../../../../packs/sketches/soundclash.yaml?raw").then((m) => m.default),
  },
  learner: {
    packId: "com.scrthq.runlog.practice-room",
    load: () => import("../../../../packs/sketches/practice-room.yaml?raw").then((m) => m.default),
  },
  "elden-lord": {
    packId: "com.scrthq.runlog.elden-ring-tarnishedtool",
    load: () => import("../../../../packs/sketches/elden-ring-tarnishedtool.yaml?raw").then((m) => m.default),
  },
  "rlcs-champion": {
    packId: "com.scrthq.runlog.rocket-league-ladder",
    load: () => import("../../../../packs/sketches/rocket-league-ladder.yaml?raw").then((m) => m.default),
  },
};

/**
 * Validate one persona's pack text against the id it is supposed to be.
 *
 * Exported on its own so the failure paths, unparseable YAML and a pack
 * that parses but is not the one asked for, are testable without a module
 * loader in the way. Both throw rather than return a fallback: a demo pack
 * that failed to validate has no marketplace copy to fall back to, and
 * showing the wrong pack under a persona's name would be worse than
 * failing loudly.
 */
export function parseDemoPack(personaId: PersonaId, text: string): Pack {
  const expectedId = sources[personaId].packId;
  const loaded = loadPackText(text, "yaml");
  if (!loaded.ok) {
    throw new Error(`Demo pack ${personaId} failed to load: ${loaded.diagnostics.map((d) => d.message).join("; ")}`);
  }
  if (loaded.pack.id !== expectedId) {
    throw new Error(`Demo pack ${personaId} failed to load: expected ${expectedId}, got ${loaded.pack.id}`);
  }
  return loaded.pack;
}

/** The one bundled pack a persona's example is drawn from. */
export async function loadDemoPack(personaId: PersonaId): Promise<Pack> {
  const text = await sources[personaId].load();
  return parseDemoPack(personaId, text);
}
