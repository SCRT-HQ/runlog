import { tryParseDice } from "./dice.ts";
import type { Action } from "./actions.ts";
import type { Pack, Score } from "./pack.ts";
import type { Predicate } from "./primitives.ts";

/**
 * Semantic validation, run after the Zod schema has confirmed the shape.
 *
 * The schema can only prove a pack is well-formed. This proves it is
 * *coherent*: that its d100 table actually covers every result a d100 can
 * produce, that nothing references a table which does not exist, and that the
 * capabilities it claims match what it uses. These are precisely the mistakes
 * a person makes transcribing a rulebook, and every one of them would
 * otherwise show up mid-session as a crash or a silently impossible roll.
 */

export type DiagnosticLevel = "error" | "warning";

export interface Diagnostic {
  level: DiagnosticLevel;
  /** Stable machine-readable code, e.g. `table/range-gap`. */
  code: string;
  message: string;
  /** Dotted path into the pack, e.g. `tables.mutation.entries[3]`. */
  path: string;
}

const err = (code: string, path: string, message: string): Diagnostic => ({
  level: "error",
  code,
  path,
  message,
});
const warn = (code: string, path: string, message: string): Diagnostic => ({
  level: "warning",
  code,
  path,
  message,
});

/** Recursively visit every action in a tree, including nested branches. */
function walkActions(actions: Action[] | undefined, visit: (a: Action) => void): void {
  if (!actions) return;
  for (const action of actions) {
    visit(action);
    switch (action.do) {
      case "branch":
        for (const c of action.cases) walkActions(c.then, visit);
        walkActions(action.else, visit);
        break;
      case "when":
        walkActions(action.then, visit);
        walkActions(action.else, visit);
        break;
      default:
        break;
    }
  }
}

function walkPredicates(preds: Predicate[] | undefined, visit: (p: Predicate) => void): void {
  if (!preds) return;
  for (const p of preds) {
    visit(p);
    if ("not" in p) walkPredicates([p.not], visit);
    if ("allOf" in p) walkPredicates(p.allOf, visit);
    if ("anyOf" in p) walkPredicates(p.anyOf, visit);
  }
}

/** Every action list in the pack, paired with where it came from. */
function collectActionSites(pack: Pack): Array<{ path: string; actions: Action[] }> {
  const sites: Array<{ path: string; actions: Action[] }> = [];

  for (const [tableId, table] of Object.entries(pack.tables)) {
    table.entries.forEach((entry, i) => {
      entry.triggers?.forEach((t, ti) => {
        sites.push({ path: `tables.${tableId}.entries[${i}].triggers[${ti}]`, actions: t.do });
      });
    });
  }
  for (const [deckId, deck] of Object.entries(pack.decks ?? {})) {
    if (deck.kind !== "cards") continue;
    deck.cards.forEach((card, i) => {
      card.triggers?.forEach((t, ti) => {
        sites.push({ path: `decks.${deckId}.cards[${i}].triggers[${ti}]`, actions: t.do });
      });
    });
  }
  for (const [counterId, counter] of Object.entries(pack.counters ?? {})) {
    counter.triggers?.forEach((t, ti) => {
      sites.push({ path: `counters.${counterId}.triggers[${ti}]`, actions: t.do });
    });
  }
  pack.phases.forEach((phase, pi) => {
    phase.steps.forEach((step, si) => {
      if (step.kind === "actions") {
        sites.push({ path: `phases[${pi}].steps[${si}]`, actions: step.do });
      }
    });
  });
  for (const [modeId, mode] of Object.entries(pack.modes)) {
    mode.perUnit?.forEach((u, ui) => {
      if (u.extra) sites.push({ path: `modes.${modeId}.perUnit[${ui}].extra`, actions: u.extra });
    });
  }
  for (const [moveId, move] of Object.entries(pack.moves ?? {})) {
    sites.push({ path: `moves.${moveId}`, actions: move.do });
  }
  pack.triggers?.forEach((t, ti) => sites.push({ path: `triggers[${ti}]`, actions: t.do }));

  return sites;
}

export function lintPack(pack: Pack): Diagnostic[] {
  const d: Diagnostic[] = [];

  const tableIds = new Set(Object.keys(pack.tables));
  const deckIds = new Set(Object.keys(pack.decks ?? {}));
  const stateIds = new Set(Object.keys(pack.states ?? {}));
  const counterIds = new Set(Object.keys(pack.counters ?? {}));
  const resourceIds = new Set(Object.keys(pack.resources ?? {}));
  const phaseIds = new Set(pack.phases.map((p) => p.id));
  const moveIds = new Set(Object.keys(pack.moves ?? {}));

  // ---- Tables ------------------------------------------------------------
  let usesOpposed = false;
  let usesKeyed = false;
  const keyedTables = new Set<string>();

  for (const [tableId, table] of Object.entries(pack.tables)) {
    const path = `tables.${tableId}`;

    // Common to every resolution kind: unique entry ids, real state grants.
    const seenEntryIds = new Set<string>();
    for (const entry of table.entries) {
      if (seenEntryIds.has(entry.id)) {
        d.push(err("table/duplicate-entry-id", path, `duplicate entry id ${entry.id}`));
      }
      seenEntryIds.add(entry.id);
      for (const state of entry.grants ?? []) {
        if (!stateIds.has(state)) {
          d.push(
            err("ref/unknown-state", path, `entry ${entry.id} grants undeclared state ${state}`),
          );
        }
      }
    }

    if (table.resolution === "lookup") {
      const dice = tryParseDice(table.roll);
      if (!dice) {
        d.push(err("dice/invalid", `${path}.roll`, `cannot parse dice expression ${table.roll}`));
        continue;
      }
      // A lookup table must tile the entire range its dice can produce. A gap
      // means a legal roll has no result, which surfaces mid-session as a dead
      // end; an overlap means two results claim the same roll.
      const sorted = [...table.entries].sort((a, b) => a.range[0] - b.range[0]);
      let cursor = dice.min;
      for (const entry of sorted) {
        const [lo, hi] = entry.range;
        if (lo > cursor) {
          d.push(
            err(
              "table/range-gap",
              path,
              `no entry covers ${cursor === lo - 1 ? cursor : `${cursor}-${lo - 1}`} (rollable on ${table.roll})`,
            ),
          );
        } else if (lo < cursor) {
          d.push(
            err(
              "table/range-overlap",
              path,
              `entry ${entry.id} starts at ${lo} but ${lo}-${Math.min(hi, cursor - 1)} is already covered`,
            ),
          );
        }
        cursor = Math.max(cursor, hi + 1);
      }
      if (cursor <= dice.max) {
        d.push(
          err(
            "table/range-gap",
            path,
            `no entry covers ${cursor === dice.max ? cursor : `${cursor}-${dice.max}`} (rollable on ${table.roll})`,
          ),
        );
      }
      for (const entry of table.entries) {
        if (entry.range[0] < dice.min || entry.range[1] > dice.max) {
          d.push(
            err(
              "table/range-unrollable",
              path,
              `entry ${entry.id} covers ${entry.range[0]}-${entry.range[1]}, outside the ${dice.min}-${dice.max} range of ${table.roll}`,
            ),
          );
        }
      }
    } else if (table.resolution === "bands") {
      const dice = tryParseDice(table.roll);
      if (!dice) {
        d.push(err("dice/invalid", `${path}.roll`, `cannot parse dice expression ${table.roll}`));
        continue;
      }
      // Bands: warn on totals no band claims, but do not error -- open ladders
      // with a deliberate "anything else" fallthrough are a legitimate style.
      const covered = (n: number) =>
        table.entries.some((e) => (e.gte ?? -Infinity) <= n && n <= (e.lte ?? Infinity));
      const uncovered: number[] = [];
      for (let n = dice.min; n <= dice.max; n++) if (!covered(n)) uncovered.push(n);
      if (uncovered.length > 0) {
        d.push(
          warn(
            "table/band-gap",
            path,
            `${uncovered.length} rollable total(s) match no band, e.g. ${uncovered.slice(0, 5).join(", ")}`,
          ),
        );
      }
    } else if (table.resolution === "opposed") {
      usesOpposed = true;
      if (!tryParseDice(table.action)) {
        d.push(err("dice/invalid", `${path}.action`, `cannot parse action dice ${table.action}`));
      }
      if (!tryParseDice(table.challenge.dice)) {
        d.push(
          err(
            "dice/invalid",
            `${path}.challenge.dice`,
            `cannot parse challenge dice ${table.challenge.dice}`,
          ),
        );
      }
      if (table.addResource && !resourceIds.has(table.addResource)) {
        d.push(
          err(
            "ref/unknown-resource",
            `${path}.addResource`,
            `unknown resource ${table.addResource}`,
          ),
        );
      }
      // An opposed roll can beat anywhere from none of the challenge dice to
      // all of them. Every rung must exist, or a legal roll has no outcome.
      const seen = new Map<number, string>();
      for (const outcome of table.entries) {
        if (outcome.beats > table.challenge.count) {
          d.push(
            err(
              "table/unreachable-outcome",
              path,
              `outcome ${outcome.id} needs to beat ${outcome.beats} dice but only ${table.challenge.count} are rolled`,
            ),
          );
        }
        const prior = seen.get(outcome.beats);
        if (prior) {
          d.push(
            err(
              "table/duplicate-outcome",
              path,
              `outcomes ${prior} and ${outcome.id} both claim beats: ${outcome.beats}`,
            ),
          );
        }
        seen.set(outcome.beats, outcome.id);
      }
      const missing: number[] = [];
      for (let n = 0; n <= table.challenge.count; n++) if (!seen.has(n)) missing.push(n);
      if (missing.length > 0) {
        d.push(
          err(
            "table/missing-outcome",
            path,
            `no outcome for beats: ${missing.join(", ")} -- every result from 0 to ${table.challenge.count} needs one`,
          ),
        );
      }
    } else {
      usesKeyed = true;
      keyedTables.add(tableId);
      const seenKeys = new Set<string>();
      for (const entry of table.entries) {
        const key = entry.key.toLowerCase();
        if (seenKeys.has(key)) {
          d.push(err("table/duplicate-key", path, `duplicate key ${entry.key}`));
        }
        seenKeys.add(key);
      }
    }
  }

  // ── Reference integrity across every action in the pack ─────────────────
  let usesDecks = deckIds.size > 0;
  let usesResources = resourceIds.size > 0;
  let usesTimers = false;
  let usesResolveTarget = false;
  /** Counters something moves by hand: an action, or a checklist tally. Not inert. */
  const movedCounters = new Set<string>();

  for (const site of collectActionSites(pack)) {
    walkActions(site.actions, (a) => {
      switch (a.do) {
        case "rollOn":
          if (!tableIds.has(a.table)) {
            d.push(err("ref/unknown-table", site.path, `rollOn references unknown table ${a.table}`));
          }
          break;
        case "applyState":
        case "removeState":
          if (!stateIds.has(a.state)) {
            d.push(err("ref/unknown-state", site.path, `references unknown state ${a.state}`));
          }
          break;
        case "modCounter":
          if (!counterIds.has(a.counter)) {
            d.push(err("ref/unknown-counter", site.path, `references unknown counter ${a.counter}`));
          }
          movedCounters.add(a.counter);
          break;
        case "modResource":
          if (!resourceIds.has(a.resource)) {
            d.push(
              err("ref/unknown-resource", site.path, `references unknown resource ${a.resource}`),
            );
          }
          usesResources = true;
          break;
        case "grantCard":
        case "discardCard":
          if (!deckIds.has(a.deck)) {
            d.push(err("ref/unknown-deck", site.path, `references unknown deck ${a.deck}`));
          }
          usesDecks = true;
          break;
        case "startStopwatch":
        case "startTimer":
          usesTimers = true;
          break;
        case "resolveTarget":
          usesResolveTarget = true;
          if (!pack.targeting || pack.targeting.strategy === "none") {
            d.push(
              err(
                "targeting/unavailable",
                site.path,
                "resolveTarget is used but the pack declares no targeting strategy",
              ),
            );
          }
          break;
        default:
          break;
      }
    });
  }

  // ── License ─────────────────────────────────────────────────────────────
  if ((pack.license.id === "proprietary" || pack.license.id === "custom") && !pack.license.text?.trim()) {
    d.push(err("license/text-required", "license.text", `a ${pack.license.id} license needs its terms in license.text`));
  }

  // ── Requirements ────────────────────────────────────────────────────────
  const requirements = new Map((pack.requires ?? []).map((r) => [r.id, r]));
  for (const [tableId, table] of Object.entries(pack.tables)) {
    table.entries.forEach((e, i) => {
      for (const need of e.needs ?? []) {
        const r = requirements.get(need);
        if (!r) d.push(err("ref/unknown-requirement", `tables.${tableId}.entries[${i}].needs`, `needs unknown requirement ${need}`));
        else if (!r.optional) {
          d.push(warn("requirement/never-lacked", `tables.${tableId}.entries[${i}].needs`, `needs ${need}, which is not optional, so no run can lack it; the entry will never be skipped`));
        }
      }
    });
  }

  // ── Predicate references ────────────────────────────────────────────────
  const predicateSites: Array<{ path: string; preds: Predicate[] | undefined }> = [];
  for (const [tableId, table] of Object.entries(pack.tables)) {
    table.entries.forEach((e, i) =>
      predicateSites.push({ path: `tables.${tableId}.entries[${i}].requires`, preds: e.requires }),
    );
  }
  for (const [moveId, move] of Object.entries(pack.moves ?? {})) {
    predicateSites.push({ path: `moves.${moveId}.available`, preds: move.available });
  }
  pack.phases.forEach((p, pi) => {
    predicateSites.push({ path: `phases[${pi}].skipWhen`, preds: p.skipWhen });
    p.steps.forEach((s, si) => {
      if ("skipWhen" in s) {
        predicateSites.push({ path: `phases[${pi}].steps[${si}].skipWhen`, preds: s.skipWhen });
      }
    });
  });
  for (const site of predicateSites) {
    walkPredicates(site.preds, (p) => {
      // Bounds may now name a counter, so those references need checking too.
      for (const bound of Object.values(p as Record<string, unknown>)) {
        if (bound && typeof bound === "object") {
          const b = bound as { gteCounter?: string; lteCounter?: string };
          for (const ref of [b.gteCounter, b.lteCounter]) {
            if (ref && !counterIds.has(ref)) {
              d.push(
                err("ref/unknown-counter", site.path, `bound references unknown counter ${ref}`),
              );
            }
          }
        }
      }
      if ("counter" in p && !counterIds.has(p.counter)) {
        d.push(err("ref/unknown-counter", site.path, `predicate references unknown counter ${p.counter}`));
      }
      if ("resource" in p && !resourceIds.has(p.resource)) {
        d.push(err("ref/unknown-resource", site.path, `predicate references unknown resource ${p.resource}`));
      }
      if ("subjectHasState" in p && !stateIds.has(p.subjectHasState)) {
        d.push(err("ref/unknown-state", site.path, `predicate references unknown state ${p.subjectHasState}`));
      }
      if ("modeIs" in p) {
        for (const m of p.modeIs) {
          if (!(m in pack.modes)) {
            d.push(err("ref/unknown-mode", site.path, `predicate references unknown mode ${m}`));
          }
        }
      }
      if ("phaseDone" in p && !pack.phases.some((ph) => ph.id === p.phaseDone)) {
        d.push(err("ref/unknown-phase", site.path, `predicate references unknown phase ${p.phaseDone}`));
      }
    });
  }

  // ── Phases and steps ────────────────────────────────────────────────────
  const seenPhaseIds = new Set<string>();
  pack.phases.forEach((phase, pi) => {
    if (seenPhaseIds.has(phase.id)) {
      d.push(err("phase/duplicate-id", `phases[${pi}]`, `duplicate phase id ${phase.id}`));
    }
    seenPhaseIds.add(phase.id);
    phase.steps.forEach((step, si) => {
      const path = `phases[${pi}].steps[${si}]`;
      if (step.kind === "rollTable" && !tableIds.has(step.table)) {
        d.push(err("ref/unknown-table", path, `step rolls on unknown table ${step.table}`));
      }
      if (step.kind === "declareSubject" && step.constrainedBy && !tableIds.has(step.constrainedBy)) {
        d.push(err("ref/unknown-table", path, `constrainedBy references unknown table ${step.constrainedBy}`));
      }
      // A point that shows a table's results has to name a table that exists,
      // or the player is promised evidence and shown nothing.
      const points = step.kind === "manual" ? step.checklist : step.kind === "finalizeUnit" ? step.confirm : undefined;
      points?.forEach((item, ii) => {
        const field = step.kind === "manual" ? "checklist" : "confirm";
        if (typeof item !== "string" && item.tally && !counterIds.has(item.tally)) {
          d.push(err("ref/unknown-counter", `${path}.${field}[${ii}]`, `tallies unknown counter ${item.tally}`));
        }
        if (typeof item !== "string" && item.tally) movedCounters.add(item.tally);
        const shown = typeof item !== "string" && item.shows ? (Array.isArray(item.shows.table) ? item.shows.table : [item.shows.table]) : [];
        for (const t of shown.filter((t) => !tableIds.has(t))) {
          d.push(err("ref/unknown-table", `${path}.${field}[${ii}]`, `shows unknown table ${t}`));
        }
      });
    });
  });
  if (!pack.phases.some((p) => p.steps.some((s) => s.kind === "finalizeUnit"))) {
    d.push(
      err(
        "phase/no-finalize",
        "phases",
        "no phase contains a finalizeUnit step, so a unit can never be completed",
      ),
    );
  }

  // ── Decks ───────────────────────────────────────────────────────────────
  for (const [deckId, deck] of Object.entries(pack.decks ?? {})) {
    if (deck.kind === "standard52" && deck.resolveOn) {
      const refPath = `decks.${deckId}.resolveOn`;
      if (!tableIds.has(deck.resolveOn)) {
        d.push(err("ref/unknown-table", refPath, `unknown table ${deck.resolveOn}`));
      } else if (!keyedTables.has(deck.resolveOn)) {
        // A card is not a die roll. Pointing a draw at a numeric table would
        // only work by pretending ranks are d13 results, so require the honest
        // form instead.
        d.push(
          err(
            "deck/resolve-not-keyed",
            refPath,
            `table ${deck.resolveOn} must use "keyed" resolution to resolve a card draw`,
          ),
        );
      } else {
        const keyed = pack.tables[deck.resolveOn] as { entries: Array<{ key: string }> };
        const expected =
          deck.resolveBy === "suit"
            ? ["hearts", "diamonds", "clubs", "spades"]
            : ["a", "2", "3", "4", "5", "6", "7", "8", "9", "10", "j", "q", "k"];
        const present = new Set(keyed.entries.map((e) => e.key.toLowerCase()));
        const missing = expected.filter((k) => !present.has(k));
        if (missing.length > 0) {
          d.push(
            warn(
              "deck/uncovered-key",
              refPath,
              `table ${deck.resolveOn} has no entry for ${deck.resolveBy}: ${missing.join(", ")}`,
            ),
          );
        }
      }
    }
    if (deck.kind === "cards") {
      const ids = new Set<string>();
      for (const card of deck.cards) {
        if (ids.has(card.id)) {
          d.push(err("deck/duplicate-card-id", `decks.${deckId}`, `duplicate card id ${card.id}`));
        }
        ids.add(card.id);
      }
      if (deck.drawAtStart > deck.cards.length) {
        d.push(
          err(
            "deck/overdraw",
            `decks.${deckId}`,
            `drawAtStart is ${deck.drawAtStart} but the deck holds ${deck.cards.length} cards`,
          ),
        );
      }
    }
  }

  // ── Modes ───────────────────────────────────────────────────────────────
  if (!(pack.defaultMode in pack.modes)) {
    d.push(err("ref/unknown-mode", "defaultMode", `defaultMode ${pack.defaultMode} is not defined in modes`));
  }
  for (const [modeId, mode] of Object.entries(pack.modes)) {
    for (const t of mode.disable?.tables ?? []) {
      if (!tableIds.has(t)) d.push(err("ref/unknown-table", `modes.${modeId}.disable`, `unknown table ${t}`));
    }
    for (const p of mode.disable?.phases ?? []) {
      if (!phaseIds.has(p)) d.push(err("ref/unknown-phase", `modes.${modeId}.disable`, `unknown phase ${p}`));
    }
    for (const c of mode.disable?.counters ?? []) {
      if (!counterIds.has(c)) d.push(err("ref/unknown-counter", `modes.${modeId}.disable`, `unknown counter ${c}`));
    }
    mode.perUnit?.forEach((u, ui) => {
      for (const p of u.skipPhases ?? []) {
        if (!phaseIds.has(p)) {
          d.push(err("ref/unknown-phase", `modes.${modeId}.perUnit[${ui}]`, `unknown phase ${p}`));
        }
      }
    });
    if (mode.players && mode.players.max > 1 && mode.players.rotate === "none") {
      d.push(
        warn(
          "mode/no-rotation",
          `modes.${modeId}.players`,
          "multi-player mode does not rotate roles; every unit will belong to the same player",
        ),
      );
    }
  }

  // ── Counters ────────────────────────────────────────────────────────────
  for (const [counterId, counter] of Object.entries(pack.counters ?? {})) {
    const path = `counters.${counterId}`;
    for (const sel of [...(counter.incrementOn ?? []), ...(counter.resetOn ?? [])]) {
      if (sel.on === "tableRolled" || sel.on === "outcomeResolved") {
        if (!tableIds.has(sel.table)) {
          d.push(err("ref/unknown-table", path, `hooks unknown table ${sel.table}`));
        }
      }
      if (sel.on === "phaseCompleted" && !phaseIds.has(sel.phase)) {
        d.push(err("ref/unknown-phase", path, `hooks unknown phase ${sel.phase}`));
      }
      if (sel.on === "stateApplied" && !stateIds.has(sel.state)) {
        d.push(err("ref/unknown-state", path, `hooks unknown state ${sel.state}`));
      }
    }
    if (!counter.incrementOn?.length && !counter.triggers?.length && !movedCounters.has(counterId)) {
      d.push(warn("counter/inert", path, "counter has no incrementOn, no triggers, and nothing moves it; it will never change"));
    }
  }

  // ── Score ───────────────────────────────────────────────────────────────
  //
  // A dangling reference here does not stop a run — scoreOf is total and
  // falls back to 0 or to wall time — so these are warnings, not the errors a
  // dangling reference is everywhere else: the worst case is a scoreboard
  // that quietly reads zero, not a crash mid-session.
  const checkScore = (score: Score | undefined, path: string, modeId?: string) => {
    if (!score) return;
    if ("counter" in score && !counterIds.has(score.counter)) {
      d.push(warn("score/unknown-counter", path, `score references unknown counter ${score.counter}`));
    }
    if ("resource" in score && !resourceIds.has(score.resource)) {
      d.push(warn("score/unknown-resource", path, `score references unknown resource ${score.resource}`));
    }
    if ("time" in score) {
      const mode = modeId ? pack.modes[modeId] : undefined;
      if (!(mode?.clock ?? pack.unit.clock)) {
        d.push(
          warn(
            "score/no-clock",
            path,
            `score is by time, but ${modeId ? `mode ${modeId}` : "the pack"} runs no clock; it will fall back to wall time`,
          ),
        );
      }
    }
  };
  checkScore(pack.score, "score");
  for (const [modeId, mode] of Object.entries(pack.modes)) {
    checkScore(mode.score, `modes.${modeId}.score`, modeId);
  }

  // ── Targeting ───────────────────────────────────────────────────────────
  if (pack.targeting?.strategy === "anchoredOffset") {
    for (const [i, band] of pack.targeting.bands.entries()) {
      const [lo, hi] = band.range;
      if (lo > hi) {
        d.push(err("targeting/bad-band", `targeting.bands[${i}]`, `range [${lo}, ${hi}] is inverted`));
      }
      if (band.anchor !== "playerChoice" && !band.direction) {
        d.push(
          err(
            "targeting/missing-direction",
            `targeting.bands[${i}]`,
            `anchor ${band.anchor} needs a direction (before/after)`,
          ),
        );
      }
    }
  }

  // ── Pack-level triggers: can they ever fire? ────────────────────────────
  //
  // A trigger on the pack rather than on a result has no result to hang from,
  // so only the points the run itself passes through can reach it. Anything
  // else is silently dead — the end-of-run roll that never happens is exactly
  // the bug a linter should catch before a player notices it missing.
  const globalPoints = new Set(["onEnterUnit", "onRunEnd"]);
  pack.triggers?.forEach((t, i) => {
    if (!globalPoints.has(t.on)) {
      d.push(
        err(
          "trigger/unreachable-point",
          `triggers[${i}].on`,
          `a pack-level trigger can only fire on ${[...globalPoints].join(" or ")}; "${t.on}" would never happen`,
        ),
      );
    }
  });

  // ── Roles: something to rotate ──────────────────────────────────────────
  for (const [modeId, mode] of Object.entries(pack.modes)) {
    const players = mode.players;
    if (!players) continue;
    if (players.max < players.min) {
      d.push(
        err(
          "mode/player-range",
          `modes.${modeId}.players`,
          `max (${players.max}) is below min (${players.min})`,
        ),
      );
    }
    if (players.rotate === "clockwise" && !players.roles?.length) {
      d.push(
        warn(
          "mode/rotate-without-roles",
          `modes.${modeId}.players.rotate`,
          "roles are set to rotate, but the mode declares none",
        ),
      );
    }
    if ((players.roles?.length ?? 0) > 0 && players.max < 2) {
      d.push(
        warn(
          "mode/roles-without-players",
          `modes.${modeId}.players.roles`,
          "roles are declared, but the mode is played by one person",
        ),
      );
    }
  }

  // ── Capabilities: claimed vs. used ──────────────────────────────────────
  const claimed = new Set(pack.capabilities);
  const requireCap = (cap: string, used: boolean, why: string) => {
    if (used && !claimed.has(cap as never)) {
      d.push(
        warn(
          "capability/undeclared",
          "capabilities",
          `pack ${why} but does not declare the "${cap}" capability`,
        ),
      );
    }
  };
  const moderatedModes = Object.values(pack.modes).filter((m) => m.moderated);
  const scoringEntries = Object.values(pack.tables).some((t) => t.entries.some((e) => (e.points ?? 0) > 0));
  requireCap("moderated", moderatedModes.length > 0, "has a moderated mode");
  if (moderatedModes.length > 0 && !scoringEntries) {
    d.push(warn("mode/nothing-to-award", "modes", "a mode is moderated, but no table entry carries points, so there is nothing to award"));
  }
  for (const [modeId, m] of Object.entries(pack.modes)) {
    if (m.moderated && m.moderated.contestants.max < m.moderated.contestants.min) {
      d.push(err("mode/contestant-range", `modes.${modeId}.moderated.contestants`, `max (${m.moderated.contestants.max}) is below min (${m.moderated.contestants.min})`));
    }
  }
  requireCap("decks", usesDecks, "uses decks");
  requireCap("resources", usesResources, "uses resources");
  requireCap("counters", counterIds.size > 0, "declares counters");
  const unitClock = Boolean(pack.unit.clock) || Object.values(pack.modes).some((m) => m.clock);
  requireCap("timers", usesTimers || unitClock, "runs a clock");
  requireCap(
    "backwardTargeting",
    usesResolveTarget || (!!pack.targeting && pack.targeting.strategy !== "none"),
    "defines targeting",
  );
  requireCap(
    "bandsResolution",
    Object.values(pack.tables).some((t) => t.resolution === "bands"),
    "uses bands resolution",
  );
  requireCap("opposedResolution", usesOpposed, "uses opposed resolution");
  requireCap("keyedResolution", usesKeyed, "uses keyed resolution");
  requireCap(
    "standardDeck",
    Object.values(pack.decks ?? {}).some((x) => x.kind === "standard52"),
    "uses a standard 52-card deck",
  );
  requireCap("journal", !!pack.journal?.enabled, "enables the journal");
  requireCap(
    "coopRoles",
    Object.values(pack.modes).some((m) => (m.players?.max ?? 1) > 1),
    "defines a multi-player mode",
  );
  requireCap(
    "seededRuns",
    Object.values(pack.modes).some((m) => m.seeded),
    "defines a seeded mode",
  );
  requireCap(
    "deferredTriggers",
    Object.values(pack.tables).some((t) =>
      t.entries.some((e) => e.triggers?.some((tr) => tr.on !== "immediately")),
    ) || (pack.triggers?.length ?? 0) > 0,
    "uses deferred triggers",
  );

  // ── Play fixtures ────────────────────────────────────────────────────────
  // Only what the schema cannot already rule out: that a step names a phase
  // (or phase#index) which actually exists, and that a move names one that
  // does. A typo here would otherwise surface only when the fixture ran, with
  // a message about "the active step" that says nothing about the pack.
  pack.fixtures?.forEach((fixture, fi) => {
    if (!("play" in fixture)) return;
    const path = `fixtures[${fi}].play`;
    fixture.play.forEach((step, si) => {
      if ("step" in step) {
        const [phaseId] = step.step.split("#");
        if (!phaseIds.has(phaseId ?? "")) {
          d.push(err("fixture/unknown-phase", `${path}[${si}]`, `step references unknown phase ${phaseId}`));
        }
      } else if ("move" in step) {
        if (!moveIds.has(step.move)) {
          d.push(err("fixture/unknown-move", `${path}[${si}]`, `references unknown move ${step.move}`));
        }
      }
    });
  });

  return d;
}

export const hasErrors = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some((x) => x.level === "error");
