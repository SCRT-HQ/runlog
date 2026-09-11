import type { Action } from "./actions.ts";
import type { Mode, Pack, Score } from "./pack.ts";
import type { DiceExpr, NumericBound, Predicate, TargetRef, TriggerPoint } from "./primitives.ts";
import type { Table, Trigger } from "./tables.ts";

/**
 * A pack, said in words.
 *
 * Everything a pack declares is data the engine acts on; a person reading
 * the rules wants the same things as sentences. These helpers turn the
 * closed vocabularies, actions, predicates, bounds, trigger points, a
 * mode's length, into prose in the pack's own nouns, so a generated
 * rulebook says "when you Fire the Stage" and not "onFinalize". They are
 * shared by the app (the Rules view, the marketplace) and the command line
 * (`runlog docs`), which is why they live here and not in either.
 */

/* ---- tables ------------------------------------------------------------- */

/**
 * The left-hand key shown against each entry: a roll range, a band, a rung of
 * an opposed ladder, or a literal key.
 *
 * Computed per table rather than per entry because only inside a branch on
 * `table.resolution` does the entry type narrow: the element type of
 * `table.entries` is a union until then.
 */
export function entryKeys(table: Table): string[] {
  switch (table.resolution) {
    case "lookup":
      return table.entries.map((e) => (e.range[0] === e.range[1] ? `${e.range[0]}` : `${e.range[0]}-${e.range[1]}`));
    case "bands":
      return table.entries.map((e) =>
        [e.gte !== undefined ? `≥${e.gte}` : "", e.lte !== undefined ? `≤${e.lte}` : ""].filter(Boolean).join(" "),
      );
    case "opposed":
      return table.entries.map((e) => `beats ${e.beats}`);
    case "keyed":
      return table.entries.map((e) => e.key);
  }
}

/** A short description of how a table is consulted, for the table header. */
export function describeRoll(table: Table): string {
  switch (table.resolution) {
    case "lookup":
    case "bands":
      return table.roll;
    case "opposed":
      return `${table.action} vs ${table.challenge.count}×${table.challenge.dice}`;
    case "keyed":
      return "by key";
  }
}

/** The same, as a sentence: "Roll d100." / "Roll 2d6 against 3×d6." / "Look up by key." */
export function howConsulted(table: Table): string {
  switch (table.resolution) {
    case "lookup":
      return `Roll ${table.roll}.`;
    case "bands":
      return `Roll ${table.roll} and find the band it lands in.`;
    case "opposed":
      return `Roll ${table.action}${table.addResource ? ` and add ${table.addResource}` : ""} against ${table.challenge.count} × ${table.challenge.dice}; count how many of the challenge dice your total beats.`;
    case "keyed":
      return "Find the row whose key matches what was drawn.";
  }
}

/* ---- the pack's nouns ----------------------------------------------------- */

/**
 * "a" or "an" before a word, by its sound: an expedition, a unit, an hour.
 * The nouns are the pack's, so the article cannot be written in advance.
 */
export function an(word: string, capital = false): string {
  const w = word.trim().toLowerCase();
  const vowel = /^[aeiou]/.test(w);
  const soundsConsonant = /^(u[^aeiou]|un[aeiou]|uni|use|usu|ute|eu|one(?![a-z])|onc)/.test(w) || /^u[st][aeiou]/.test(w);
  const silentH = /^(hour|honest|honor|heir|herb)/.test(w);
  const article = (vowel && !soundsConsonant) || silentH ? "an" : "a";
  return `${capital ? article[0]!.toUpperCase() + article.slice(1) : article} ${word}`;
}

/** The words a pack uses for its parts, with sensible defaults. */
export function nouns(pack: Pack) {
  const v = pack.vocabulary;
  return {
    run: v.run.one,
    runs: v.run.many,
    unit: v.unit.one,
    units: v.unit.many,
    subject: v.subject.one,
    subjects: v.subject.many,
    finalize: v.finalize,
  };
}

const label = (pack: Pack, kind: "tables" | "decks" | "states" | "counters" | "resources" | "modes", id: string): string => {
  const entry = (pack[kind] as Record<string, { label?: string; title?: string }> | undefined)?.[id];
  return entry?.label ?? entry?.title ?? id;
};

export function targetInWords(pack: Pack, to: TargetRef | undefined): string {
  const n = nouns(pack);
  if (to === undefined) return `this ${n.subject}`;
  if (typeof to === "object") return `the ${n.subject} chosen as “${to.var}”`;
  switch (to) {
    case "thisSubject":
      return `this ${n.subject}`;
    case "targetSubject":
      return `the target`;
    case "allSubjects":
      return `every ${n.subject}`;
    case "allPriorSubjects":
      return `every earlier ${n.subject}`;
    case "run":
      return `the ${n.run}`;
  }
}

export function boundInWords(pack: Pack, b: NumericBound): string {
  const parts: string[] = [];
  if (b.eq !== undefined) parts.push(`exactly ${b.eq}`);
  if (b.gte !== undefined && b.lte !== undefined) parts.push(`between ${b.gte} and ${b.lte}`);
  else {
    if (b.gte !== undefined) parts.push(`${b.gte} or more`);
    if (b.lte !== undefined) parts.push(`${b.lte} or fewer`);
  }
  if (b.gteCounter !== undefined) parts.push(`at least the ${label(pack, "counters", b.gteCounter)} tally`);
  if (b.lteCounter !== undefined) parts.push(`no more than the ${label(pack, "counters", b.lteCounter)} tally`);
  return parts.join(" and ");
}

export function predicateInWords(pack: Pack, p: Predicate): string {
  const n = nouns(pack);
  if ("ask" in p) return `you answer yes to “${p.ask}”`;
  if ("unitIndex" in p) return p.unitIndex.eq !== undefined ? `this is ${n.unit} ${p.unitIndex.eq}` : `the ${n.unit} number is ${boundInWords(pack, p.unitIndex)}`;
  if ("subjectCount" in p) return `there are ${boundInWords(pack, p.subjectCount)} ${n.subjects}`;
  if ("eligibleTargets" in p) return `there are ${boundInWords(pack, p.eligibleTargets)} ${n.subjects} that can be targeted`;
  if ("counter" in p) return `${label(pack, "counters", p.counter)} is ${boundInWords(pack, p.is)}`;
  if ("resource" in p) return `${label(pack, "resources", p.resource)} is ${boundInWords(pack, p.is)}`;
  if ("clockRan" in p) {
    return p.clockRan === "unit"
      ? `the ${n.unit}'s clock has run ${boundInWords(pack, p.is)} minutes`
      : `the “${p.clockRan}” clock has run ${boundInWords(pack, p.is)} minutes`;
  }
  if ("clockRanOver" in p) {
    return p.clockRanOver === "unit"
      ? `the ${n.unit} ran over its timer by ${boundInWords(pack, p.is)} minutes`
      : `the “${p.clockRanOver}” timer ran over by ${boundInWords(pack, p.is)} minutes`;
  }
  if ("flag" in p) return `${p.flag} is ${p.is === false ? "not " : ""}set`;
  if ("subjectHasState" in p) return `${targetInWords(pack, p.of)} is ${label(pack, "states", p.subjectHasState)}`;
  if ("priorSubjectTagged" in p) return `an earlier ${n.subject} was tagged “${p.priorSubjectTagged}”`;
  if ("modeIs" in p) return `playing ${p.modeIs.map((m) => label(pack, "modes", m)).join(" or ")}`;
  if ("phaseDone" in p) return `${pack.phases.find((ph) => ph.id === p.phaseDone)?.label ?? p.phaseDone} is done`;
  if ("not" in p) return `not (${predicateInWords(pack, p.not)})`;
  if ("allOf" in p) return p.allOf.map((q) => predicateInWords(pack, q)).join(" and ");
  if ("anyOf" in p) return p.anyOf.map((q) => predicateInWords(pack, q)).join(" or ");
  return "";
}

/** "when A and B", or "" when there is nothing to say. */
export function conditionsInWords(pack: Pack, preds: readonly Predicate[] | undefined, joiner: "all" | "any" = "all"): string {
  if (!preds || preds.length === 0) return "";
  return preds.map((p) => predicateInWords(pack, p)).join(joiner === "all" ? " and " : ", or ");
}

const signed = (by: number | undefined, set: number | undefined): string =>
  set !== undefined ? `set to ${set}` : by === undefined ? "+1" : by >= 0 ? `+${by}` : `−${Math.abs(by)}`;

export function actionInWords(pack: Pack, a: Action): string {
  const n = nouns(pack);
  switch (a.do) {
    case "roll":
      return a.label ? `${a.label} (${a.dice})` : `roll ${a.dice}`;
    case "rollOn": {
      const t = label(pack, "tables", a.table);
      if (a.times && a.times > 1) return `roll ${a.times} times on ${t}${a.choose === "one" ? " and keep one" : ""}`;
      return `roll on ${t}`;
    }
    case "branch": {
      const cases = a.cases.map((c) => {
        const cond = c.in ? `on ${c.in.join(", ")}` : c.is ? boundInWords(pack, c.is) : "otherwise";
        return `${cond} → ${actionsInWords(pack, c.then)}`;
      });
      if (a.else) cases.push(`otherwise → ${actionsInWords(pack, a.else)}`);
      return `then, by the result: ${cases.join("; ")}`;
    }
    case "prompt":
      return a.label;
    case "resolveTarget":
      return `pick the target${a.from === "choice" ? " yourself" : a.from === "event" ? " by the pack's targeting rule" : " from the roll"}`;
    case "applyState":
      return `mark ${targetInWords(pack, a.to)} ${label(pack, "states", a.state)}`;
    case "removeState":
      return `clear ${label(pack, "states", a.state)} from ${targetInWords(pack, a.to)}`;
    case "removeSubject":
      return `remove ${targetInWords(pack, a.to)} from play`;
    case "ban":
      return a.label ?? (a.subjectType ? `no more ${a.subjectType} ${n.subjects} this ${n.run}` : `no more ${n.subjects} of ${targetInWords(pack, a.from)}'s kind this ${n.run}`);
    case "forceUnit": {
      const c = a.count ?? 1;
      return `add ${c} more ${c === 1 ? n.unit : n.units} before the ${n.run} may end`;
    }
    case "rewind": {
      const c = a.count ?? 1;
      return `go back ${c} ${c === 1 ? n.unit : n.units} when this ${n.unit} closes`;
    }
    case "extraRoll": {
      const c = a.count ?? 1;
      return `${a.unit === "current" ? `this ${n.unit}` : `the next ${n.unit}`} rolls ${label(pack, "tables", a.table)} ${c + 1} times`;
    }
    case "modCounter":
      return `${label(pack, "counters", a.counter)} ${signed(a.by, a.set)}`;
    case "modResource":
      return `${label(pack, "resources", a.resource)} ${signed(a.by, a.set)}`;
    case "grantCard": {
      const c = a.count ?? 1;
      return `draw ${c} from ${label(pack, "decks", a.deck)}`;
    }
    case "discardCard": {
      const c = a.count ?? 1;
      return `discard ${c} from ${label(pack, "decks", a.deck)}`;
    }
    case "startTimer":
      return a.label ? `${a.label} (${a.minutes} min)` : `start a ${a.minutes}-minute timer`;
    case "startStopwatch":
      return a.label ? `start the ${a.label} stopwatch` : "start a stopwatch";
    case "note":
      return a.text;
    case "setFlag":
      return a.value === false ? `unset ${a.flag}` : `set ${a.flag}`;
    case "endRunAttempt":
      return `try to end the ${n.run}`;
    case "when": {
      const then = `if ${conditionsInWords(pack, a.all)}: ${actionsInWords(pack, a.then)}`;
      return a.else ? `${then}; otherwise ${actionsInWords(pack, a.else)}` : then;
    }
  }
}

/** A list of actions as one clause: each stripped of its full stop, joined with semicolons. */
export function actionsInWords(pack: Pack, actions: readonly Action[]): string {
  return actions.map((a) => unstop(actionInWords(pack, a))).join("; ");
}

/** Without a trailing full stop, so clauses can be joined and ended once. */
export function unstop(s: string): string {
  return s.replace(/\.\s*$/, "");
}

/** With exactly one full stop at the end, unless it already ends in other punctuation. */
export function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

export function triggerPointInWords(pack: Pack, on: TriggerPoint): string {
  const n = nouns(pack);
  switch (on) {
    case "immediately":
      return "Then";
    case "onEnterUnit":
      return `When ${an(n.unit)} begins`;
    case "onDeclareSubject":
      return `When the ${n.subject} is declared`;
    case "afterWork":
      return "After the work";
    case "onFinalize":
      return `When you ${n.finalize}`;
    case "onDeclareRunOver":
      return `When you declare the ${n.run} over`;
    case "onRunEnd":
      return `When the ${n.run} ends`;
    case "onTimerExpired":
      return "When the timer runs out";
  }
}

/** "When you Fire (if this is Stage 4 or more): roll d6; Calm +1." */
export function triggerInWords(pack: Pack, t: Trigger): string {
  const when = conditionsInWords(pack, t.when);
  const head = t.label ? `${t.label} - ${triggerPointInWords(pack, t.on).toLowerCase()}` : triggerPointInWords(pack, t.on);
  return `${head}${when ? ` (if ${when})` : ""}: ${actionsInWords(pack, t.do)}`;
}

/* ---- modes -------------------------------------------------------------- */

/** How long a mode runs, in the pack's nouns. */
export function modeLength(pack: Pack, mode: Mode): string {
  const n = nouns(pack);
  const u = mode.units;
  if (u?.fixed !== undefined) return `${u.fixed} ${u.fixed === 1 ? n.unit : n.units}`;
  if (u?.roll) return `roll ${u.roll} for the number of ${n.units}`;
  if (u?.min !== undefined && u?.max !== undefined) return `${u.min}-${u.max} ${n.units}`;
  if (u?.max !== undefined) return `up to ${u.max} ${n.units}`;
  if (u?.min !== undefined) return `at least ${u.min} ${n.units}`;
  const max = pack.unit.max;
  return `as many ${n.units} as you like${max ? `, up to ${max}` : ""}`;
}

export function modePlayers(mode: Mode): string {
  const m = mode.moderated;
  if (m) {
    const n = m.contestants.min === m.contestants.max ? `${m.contestants.min}` : `${m.contestants.min}-${m.contestants.max}`;
    return `moderated, ${n} contestants, ${m.award === "everyone" ? "everyone who finishes scores" : "first to finish scores"}${m.firstBonus ? ` (+${m.firstBonus} for first)` : ""}`;
  }
  const p = mode.players;
  if (!p || (p.min <= 1 && p.max <= 1)) return "solo";
  return p.min === p.max ? `${p.min} players` : `${p.min}-${p.max} players`;
}

/**
 * A score, said as a rulebook would: "Scored by Clean Blocks; higher is
 * better, ties by time."
 *
 * Reads only the declaration, never a run: the same split as `modeLength`,
 * which is why this lives here rather than beside `scoreOf` in the engine.
 */
export function scoreInWords(pack: Pack, score: Score): string {
  const n = nouns(pack);
  const better = score.better ?? ("time" in score ? "lower" : "higher");
  const defaultName =
    "counter" in score
      ? label(pack, "counters", score.counter)
      : "resource" in score
        ? label(pack, "resources", score.resource)
        : "units" in score
          ? `${n.units} closed`
          : "Time";
  const name = score.label ?? defaultName;
  const tie = score.tiebreak ? `, ties by ${score.tiebreak === "time" ? "time" : `${n.units} closed`}` : "";
  return `Scored by ${name}; ${better} is better${tie}.`;
}

/* ---- what you need ------------------------------------------------------- */

const diceOf = (expr: DiceExpr): string => {
  const m = /^(\d*)d(\d+)/.exec(expr);
  return m ? `d${m[2]}` : expr;
};

/**
 * The dice a pack rolls, as the kinds a person has to own: every d100 is
 * "percentile dice", every dN one die. Read from the tables, the actions,
 * the modes and the targeting rule, so it cannot fall behind the pack.
 */
export function diceNeeded(pack: Pack): string[] {
  const found = new Set<string>();
  const seeActions = (actions: readonly Action[] | undefined) => {
    for (const a of actions ?? []) {
      if (a.do === "roll") found.add(diceOf(a.dice));
      if (a.do === "branch") {
        for (const c of a.cases) seeActions(c.then);
        seeActions(a.else);
      }
      if (a.do === "when") {
        seeActions(a.then);
        seeActions(a.else);
      }
    }
  };
  const seeTriggers = (triggers: readonly Trigger[] | undefined) => {
    for (const t of triggers ?? []) seeActions(t.do);
  };
  for (const table of Object.values(pack.tables)) {
    if (table.resolution === "lookup" || table.resolution === "bands") found.add(diceOf(table.roll));
    if (table.resolution === "opposed") {
      found.add(diceOf(table.action));
      found.add(diceOf(table.challenge.dice));
    }
    for (const e of table.entries) seeTriggers(e.triggers);
  }
  for (const deck of Object.values(pack.decks ?? {})) if (deck.kind === "cards") for (const c of deck.cards) seeTriggers(c.triggers);
  for (const c of Object.values(pack.counters ?? {})) for (const t of c.triggers ?? []) seeActions(t.do);
  for (const m of Object.values(pack.moves ?? {})) seeActions(m.do);
  for (const m of Object.values(pack.modes)) {
    if (m.units?.roll) found.add(diceOf(m.units.roll));
    for (const p of m.perUnit ?? []) seeActions(p.extra);
  }
  for (const p of pack.phases) for (const s of p.steps) if (s.kind === "actions") seeActions(s.do);
  seeTriggers(pack.triggers);
  if (pack.targeting?.strategy === "anchoredOffset" && pack.targeting.eventFallback) found.add(diceOf(pack.targeting.eventFallback.roll));
  return [...found].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** "Percentile dice (d100), a d6 and a d10." */
export function diceInWords(dice: readonly string[]): string {
  const names = dice.map((d) => (d === "d100" ? "percentile dice (d100)" : `a ${d}`));
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
