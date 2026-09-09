import type { ChecklistItem, Mode, Pack, Phase, Step } from "./pack.ts";
import type { Table } from "./tables.ts";
import {
  actionsInWords,
  an,
  conditionsInWords,
  diceInWords,
  diceNeeded,
  entryKeys,
  howConsulted,
  modeLength,
  modePlayers,
  nouns,
  sentence,
  triggerInWords,
} from "./describe.ts";

/**
 * Documents from a pack.
 *
 * A pack is the whole game, and a game on a table comes with paper: the
 * rulebook people read once, the quick start they read instead, the card
 * they keep beside them, the sheet they write the run on, and the blurb
 * that sells it. Each of those is a view of the same declaration, so each
 * is generated here from the pack and cannot disagree with it.
 *
 * Five kinds, one shape. A document is a list of blocks — headings, prose,
 * lists, tables, a form to write on — that the Markdown renderer, the HTML
 * renderer and the app's own view all draw the same way. Nothing here
 * touches the file system or the DOM.
 *
 * One of the five is different in what it withholds. The summary is what a
 * catalog shows before anyone has bought or added a pack: it names the
 * tables and says how they are rolled, counts the parts, describes the
 * modes — and never prints an entry, a trigger, an ending's text or a
 * mode's notes. That is the line between describing a game and giving it
 * away, and it holds whatever the license says. The other four print the
 * rules in full, which is the author's to do with their own pack and the
 * `license.redistributable` flag's to allow for anyone else.
 */

export type DocKind = "summary" | "rulebook" | "quickstart" | "reference" | "runlog";

export const DOC_KINDS: ReadonlyArray<{ kind: DocKind; label: string; what: string; full: boolean }> = [
  { kind: "summary", label: "Summary", what: "What a catalog shows: the shape of the game without its rules.", full: false },
  { kind: "rulebook", label: "Rulebook", what: "Everything, in reading order: setup, flow, every table, every rule.", full: true },
  { kind: "quickstart", label: "Quick start", what: "Enough to play the first time; the rest is on the reference card.", full: true },
  { kind: "reference", label: "Reference card", what: "Every table and the things people forget, compact enough to keep beside you.", full: true },
  { kind: "runlog", label: "Run log sheet", what: "A printable sheet to write a run on by hand.", full: true },
];

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string; tone?: "muted" | "note" }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; columns: string[]; rows: string[][]; compact?: boolean }
  | { kind: "terms"; items: Array<{ term: string; text: string }> }
  | { kind: "form"; fields: Array<{ label: string; width?: "short" | "long" | "full"; lines?: number; box?: boolean }> }
  | { kind: "rule" }
  | { kind: "pagebreak" };

export interface Doc {
  kind: DocKind;
  /** book: a reading document; card: dense columns; sheet: a form to write on. */
  layout: "book" | "card" | "sheet";
  title: string;
  subtitle?: string;
  blocks: Block[];
}

/* ---- builders ------------------------------------------------------------ */

class Builder {
  readonly blocks: Block[] = [];
  h(level: 1 | 2 | 3, text: string) {
    this.blocks.push({ kind: "heading", level, text });
    return this;
  }
  p(text: string | undefined, tone?: "muted" | "note") {
    if (text && text.trim()) this.blocks.push(tone ? { kind: "paragraph", text: text.trim(), tone } : { kind: "paragraph", text: text.trim() });
    return this;
  }
  list(items: string[], ordered = false) {
    if (items.length > 0) this.blocks.push(ordered ? { kind: "list", items, ordered } : { kind: "list", items });
    return this;
  }
  table(columns: string[], rows: string[][], compact = false) {
    if (rows.length > 0) this.blocks.push(compact ? { kind: "table", columns, rows, compact } : { kind: "table", columns, rows });
    return this;
  }
  terms(items: Array<{ term: string; text: string }>) {
    if (items.length > 0) this.blocks.push({ kind: "terms", items });
    return this;
  }
  form(fields: Array<{ label: string; width?: "short" | "long" | "full"; lines?: number; box?: boolean }>) {
    this.blocks.push({ kind: "form", fields });
    return this;
  }
  rule() {
    this.blocks.push({ kind: "rule" });
    return this;
  }
  page() {
    this.blocks.push({ kind: "pagebreak" });
    return this;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function stepInWords(pack: Pack, step: Step): string {
  const n = nouns(pack);
  switch (step.kind) {
    case "rollTable":
      return `${step.label ?? `Roll on ${pack.tables[step.table]?.title ?? step.table}`}${step.optional ? " (optional)" : ""}`;
    case "declareSubject":
      return step.label ?? `Declare the ${n.subject}${step.constrainedBy ? `, within what ${pack.tables[step.constrainedBy]?.title ?? step.constrainedBy} allowed` : ""}`;
    case "manual":
      return step.label;
    case "actions":
      return sentence(cap(actionsInWords(pack, step.do)));
    case "finalizeUnit":
      return step.label ?? `${n.finalize} the ${n.unit}`;
  }
}

const checklistText = (item: ChecklistItem): string => (typeof item === "string" ? item : item.text);

function stepDetail(pack: Pack, step: Step): string[] {
  const out: string[] = [];
  if (step.kind === "manual") {
    if (step.description) out.push(step.description);
    for (const c of step.checklist ?? []) out.push(`☐ ${checklistText(c)}`);
  }
  if (step.kind === "finalizeUnit") for (const c of step.confirm ?? []) out.push(`☐ ${checklistText(c)}`);
  if ("skipWhen" in step && step.skipWhen?.length) out.push(`Skipped when ${conditionsInWords(pack, step.skipWhen, "any")}.`);
  return out;
}

function whatYouNeed(pack: Pack): string[] {
  const n = nouns(pack);
  const items: string[] = [];
  for (const r of pack.requires ?? []) {
    items.push(`${cap(r.label)}${r.optional ? " (optional; results that need it are drawn again without it)" : ""}${r.note ? ` — ${r.note}` : ""}${r.url ? ` (${r.url})` : ""}.`);
  }
  const dice = diceInWords(diceNeeded(pack));
  if (dice) items.push(cap(dice) + ".");
  for (const deck of Object.values(pack.decks ?? {})) {
    if (deck.kind === "standard52") items.push(`A standard deck of playing cards${deck.includeJokers ? " with the jokers in" : ""}.`);
    else items.push(`${plural(deck.cards.length, "card", "cards")} for ${deck.title} — write them out, or use the app.`);
  }
  if (pack.capabilities.includes("timers") && !pack.unit.clock) items.push("A timer.");
  if (pack.unit.clock) items.push(pack.unit.clock.kind === "timer" ? `A clock: every ${n.unit} is timed, ${pack.unit.clock.minutes} minutes. The app keeps it.` : `A clock: every ${n.unit} is timed. The app keeps it.`);
  items.push(pack.journal?.enabled === false ? `Somewhere to keep the ${n.run} log.` : `Somewhere to keep the ${n.run} log — the run log sheet, or the app.`);
  return items;
}

function flowSteps(pack: Pack, opts: { detail: boolean }): string[] {
  const items: string[] = [];
  for (const phase of pack.phases) {
    const head = phase.steps.length === 1 ? `${phase.label}: ${stepInWords(pack, phase.steps[0]!)}` : phase.label;
    const notes: string[] = [];
    if (opts.detail && phase.description) notes.push(phase.description);
    if (opts.detail && phase.skipWhen?.length) notes.push(`Skipped when ${conditionsInWords(pack, phase.skipWhen, "any")}.`);
    if (phase.steps.length > 1) for (const s of phase.steps) notes.push(`${stepInWords(pack, s)}${opts.detail ? stepDetail(pack, s).map((d) => ` — ${d}`).join("") : ""}`);
    else if (opts.detail) notes.push(...stepDetail(pack, phase.steps[0]!));
    items.push([head, ...notes.map((t) => `  ${t}`)].join("\n"));
  }
  return items;
}

function modeRows(pack: Pack, opts: { notes: boolean }): string[][] {
  return Object.entries(pack.modes).map(([id, m]) => [
    `${m.label}${id === pack.defaultMode ? " (default)" : ""}`,
    modeLength(pack, m),
    modePlayers(m) + (m.seeded ? ", seeded" : ""),
    [m.description ?? "", ...(opts.notes ? modeExtras(pack, m) : [])].filter(Boolean).join(" "),
  ]);
}

function modeExtras(pack: Pack, m: Mode): string[] {
  const n = nouns(pack);
  const out: string[] = [];
  for (const note of m.notes ?? []) out.push(note);
  const off = [
    ...(m.disable?.tables ?? []).map((t) => pack.tables[t]?.title ?? t),
    ...(m.disable?.decks ?? []).map((d) => pack.decks?.[d]?.title ?? d),
    ...(m.disable?.counters ?? []).map((c) => pack.counters?.[c]?.label ?? c),
    ...(m.disable?.phases ?? []).map((p) => pack.phases.find((x) => x.id === p)?.label ?? p),
  ];
  if (off.length) out.push(`Without ${off.join(", ")}.`);
  for (const p of m.perUnit ?? []) {
    const which = p.unit === "all" ? `Every ${n.unit}` : `${cap(n.unit)} ${p.unit}`;
    const skip = (p.skipPhases ?? []).map((id) => pack.phases.find((x) => x.id === id)?.label ?? id);
    const parts = [skip.length ? `skips ${skip.join(", ")}` : "", p.extra?.length ? actionsInWords(pack, p.extra) : ""].filter(Boolean);
    if (parts.length) out.push(sentence(`${which}: ${parts.join("; ")}`));
  }
  for (const r of m.players?.roles ?? []) out.push(`${r.label}${r.acts ? " (takes the actions)" : ""}: ${r.description ?? ""}`.trim());
  return out;
}

function tableRows(pack: Pack, table: Table, opts: { full: boolean }): string[][] {
  const keys = entryKeys(table);
  return table.entries.map((e, i) => {
    const extras: string[] = [];
    if (opts.full) {
      for (const g of e.grants ?? []) extras.push(`→ ${pack.states?.[g]?.label ?? g}`);
      for (const t of e.triggers ?? []) extras.push(sentence(triggerInWords(pack, t)));
      if (e.requires?.length) extras.push(`Only if ${conditionsInWords(pack, e.requires)}; otherwise roll again.`);
    }
    const text = [e.title ? `${e.title}. ` : "", sentence(e.text), ...extras.map((x) => ` ${x}`)].join("");
    const pts = e.points !== undefined && e.points > 0 ? `${keys[i] ?? ""} · ${e.points} pt${e.points === 1 ? "" : "s"}` : (keys[i] ?? "");
    return [pts, text];
  });
}

/* ---- the five ------------------------------------------------------------ */

function license(pack: Pack): string {
  const l = pack.license;
  const who = l.holder ? ` © ${l.holder}` : "";
  return `${l.id}${who}${l.redistributable ? "" : " — private; not for redistribution"}${l.notice ? `. ${l.notice}` : ""}${l.url ? ` (${l.url})` : ""}`;
}

function byline(pack: Pack): string {
  return [pack.author ? `by ${pack.author}` : "", `version ${pack.version}`].filter(Boolean).join(" · ");
}

export function summaryDoc(pack: Pack): Doc {
  const n = nouns(pack);
  const b = new Builder();
  b.p(pack.description);
  b.p([pack.category ? `Category: ${pack.category}` : "", pack.tags?.length ? `Tags: ${pack.tags.join(", ")}` : ""].filter(Boolean).join(" · "), "muted");
  b.p(license(pack), "muted");
  if (pack.license.text) b.p(pack.license.text, "note");

  b.h(2, "How it plays");
  const unitRange = `${pack.unit.min === pack.unit.max ? pack.unit.min : `${pack.unit.min}–${pack.unit.max}`}`;
  b.p(
    `${an(n.run, true)} is a series of ${n.units}${pack.unit.createsSubject ? `, each producing ${an(n.subject)}` : ""}; ${unitRange} of them, depending on the mode. Each ${n.unit} moves through ${plural(pack.phases.length, "phase", "phases")}: ${pack.phases.map((p) => p.label).join(", ")}.`,
  );
  b.table(["Mode", "Length", "Players", "About"], modeRows(pack, { notes: false }));

  b.h(2, "What is inside");
  const tables = Object.values(pack.tables);
  const decks = Object.values(pack.decks ?? {});
  const parts: string[] = [];
  if (tables.length) parts.push(`${plural(tables.length, "table", "tables")}: ${tables.map((t) => `${t.title} (${howConsulted(t).replace(/\.$/, "").toLowerCase()}, ${plural(t.entries.length, "entry", "entries")})`).join("; ")}.`);
  if (decks.length) parts.push(`${plural(decks.length, "deck", "decks")}: ${decks.map((d) => (d.kind === "cards" ? `${d.title} (${plural(d.cards.length, "card", "cards")})` : `${d.title} (a standard deck)`)).join("; ")}.`);
  const states = Object.values(pack.states ?? {});
  if (states.length) parts.push(`${plural(states.length, "state", "states")} ${an(n.subject)} or ${n.run} can carry: ${states.map((s) => s.label).join(", ")}.`);
  const counters = Object.values(pack.counters ?? {}).filter((c) => !c.hidden);
  if (counters.length) parts.push(`${plural(counters.length, "tally", "tallies")}: ${counters.map((c) => c.label).join(", ")}.`);
  const resources = Object.values(pack.resources ?? {});
  if (resources.length) parts.push(`${plural(resources.length, "track", "tracks")}: ${resources.map((r) => r.label).join(", ")}.`);
  const moves = Object.values(pack.moves ?? {});
  if (moves.length) parts.push(`${plural(moves.length, "move", "moves")} you may make: ${moves.map((m) => m.label).join(", ")}.`);
  if (pack.endings?.length) parts.push(`${plural(pack.endings.length, "ending", "endings")}: ${pack.endings.map((e) => e.label).join(", ")}.`);
  if (pack.targeting && pack.targeting.strategy !== "none") parts.push(`Consequences can reach back to earlier ${n.subjects}.`);
  if (pack.journal?.enabled !== false) parts.push(`A journal line per ${n.unit}${pack.journal?.required ? ", required" : ""}.`);
  b.list(parts);

  b.h(2, "What you need");
  b.list(whatYouNeed(pack));
  if (pack.homepage) b.p(`More at ${pack.homepage}`, "muted");
  return { kind: "summary", layout: "book", title: pack.title, subtitle: byline(pack), blocks: b.blocks };
}

/**
 * One mode, as the summary would tell it: what is different about it,
 * how long it runs, how many play, its reminders, and the phases in
 * order. Nothing of the rules, so it may be read by anyone the summary
 * may be read by — a watcher of a live link, say.
 */
export function modeDoc(pack: Pack, modeId: string): Doc {
  const m = pack.modes[modeId];
  const b = new Builder();
  if (!m) {
    b.p(`This pack has no mode called ${modeId}.`, "muted");
    return { kind: "summary", layout: "book", title: modeId, subtitle: pack.title, blocks: b.blocks };
  }
  const n = nouns(pack);
  b.p(m.description ?? `One way to play ${pack.title}.`);
  b.p(`${cap(modeLength(pack, m))}, ${modePlayers(m)}${m.seeded ? ", seeded so every copy rolls the same" : ""}.${modeId === pack.defaultMode ? " The default." : ""}`, "muted");
  const extras = modeExtras(pack, m);
  if (extras.length) {
    b.h(2, "In this mode");
    b.list(extras);
  }
  const off = new Set(m.disable?.phases ?? []);
  b.h(2, `${cap(an(n.unit))}, in order`);
  b.list(pack.phases.filter((p) => !off.has(p.id)).map((p) => p.label), true);
  return { kind: "summary", layout: "book", title: m.label, subtitle: pack.title, blocks: b.blocks };
}

export function rulebookDoc(pack: Pack): Doc {
  const n = nouns(pack);
  const b = new Builder();
  b.p(pack.description);
  b.p(license(pack), "muted");
  if (pack.license.text) b.p(pack.license.text, "note");

  b.h(2, "What you need");
  b.list(whatYouNeed(pack));

  b.h(2, "Terms");
  b.terms([
    { term: cap(n.run), text: `One session of play. ${an(n.run, true)} is a series of ${n.units}, and ends when you say so or when the game does.` },
    { term: cap(n.unit), text: `One round. Every ${n.unit} passes through the same phases${pack.unit.createsSubject ? ` and produces one ${n.subject}` : ""}.` },
    ...(pack.unit.createsSubject ? [{ term: cap(n.subject), text: `The thing ${an(n.unit)} makes. States attach to it, and consequences can land on it later.` }] : []),
    { term: cap(n.finalize), text: `Closing ${an(n.unit)}. Once ${n.finalize.toLowerCase()}d, what it made is fixed unless a rule says otherwise.` },
    ...Object.entries(pack.vocabulary.terms ?? {}).map(([term, text]) => ({ term, text })),
  ]);
  if (pack.hierarchy?.length) b.p(`When rules contradict each other, the more specific wins, in this order: ${pack.hierarchy.join(" > ")}.`, "note");

  b.h(2, `${an(n.unit, true)}, step by step`);
  b.list(flowSteps(pack, { detail: true }), true);
  if (pack.journal?.enabled !== false) b.p(`${pack.journal?.prompt ? `After each ${n.unit}: “${pack.journal.prompt}”` : `Keep a line of notes per ${n.unit}.`}${pack.journal?.required ? " A note is required before moving on." : ""}`);

  b.h(2, "Modes");
  b.table(["Mode", "Length", "Players", "About"], modeRows(pack, { notes: true }));

  b.h(2, "Tables");
  for (const [id, table] of Object.entries(pack.tables)) {
    b.h(3, table.title);
    b.p([howConsulted(table), table.description ?? ""].filter(Boolean).join(" "));
    b.table([table.resolution === "keyed" ? "Key" : "Roll", "Result"], tableRows(pack, table, { full: true }));
    void id;
  }

  const decks = Object.entries(pack.decks ?? {});
  if (decks.length) {
    b.h(2, "Cards");
    for (const [, deck] of decks) {
      b.h(3, deck.title);
      if (deck.kind === "standard52") {
        b.p([deck.description, `A standard deck${deck.includeJokers ? " with jokers" : ""}; ${deck.drawAtStart ? `draw ${deck.drawAtStart} at the start. ` : ""}Each draw is read by ${deck.resolveBy}${deck.resolveOn ? ` on ${pack.tables[deck.resolveOn]?.title ?? deck.resolveOn}` : ""}.`].filter(Boolean).join(" "));
      } else {
        b.p([deck.description, deck.drawAtStart ? `Draw ${deck.drawAtStart} at the start.` : "", deck.unique ? "" : "Cards may repeat.", deck.carriesOver ? `Unused cards carry over to the next ${n.run}.` : ""].filter(Boolean).join(" "));
        b.table(
          ["Card", "Effect"],
          deck.cards.map((c) => [c.title, [c.text, ...(c.triggers ?? []).map((t) => triggerInWords(pack, t)), c.requires?.length ? `Only if ${conditionsInWords(pack, c.requires)}.` : ""].filter(Boolean).join(" ")]),
        );
      }
    }
  }

  const states = Object.entries(pack.states ?? {});
  if (states.length) {
    b.h(2, "States");
    b.table(
      ["State", "On", "Means"],
      states.map(([, s]) => [
        s.short ? `${s.label} (${s.short})` : s.label,
        s.scope === "run" ? `the ${n.run}` : s.scope === "contestant" ? "a contestant" : an(n.subject),
        [s.description ?? "", ...(s.semantics ?? []).map(semanticInWords), s.group ? `Replaces any other “${s.group}” state.` : "", s.until === "unitEnd" ? `Lifts when the ${n.unit} closes.` : ""].filter(Boolean).join(" "),
      ]),
    );
  }

  const counters = Object.entries(pack.counters ?? {}).filter(([, c]) => !c.hidden);
  const resources = Object.entries(pack.resources ?? {});
  if (counters.length || resources.length) {
    b.h(2, "Tallies and tracks");
    b.table(
      ["Name", "Starts at", "Rule"],
      [
        ...counters.map(([, c]) => [
          c.label,
          String(c.initial ?? 0),
          [
            c.min !== undefined && c.max !== undefined ? `Stays within ${c.min}–${c.max}.` : c.max !== undefined ? `Never above ${c.max}.` : c.min !== undefined && c.min !== 0 ? `Never below ${c.min}.` : "",
            ...(c.triggers ?? []).map((t) => sentence(`${t.label ? `${t.label} — ` : ""}at ${boundText(t.when)}${t.oncePerRun ? `, once per ${n.run}` : ""}: ${actionsInWords(pack, t.do)}`)),
          ]
            .filter(Boolean)
            .join(" "),
        ]),
        ...resources.map(([, r]) => [r.label, String(r.initial ?? 0), [r.description ?? "", `From ${r.min ?? 0}${r.max !== undefined ? ` to ${r.max}` : ""}, in steps of ${r.step ?? 1}.`].filter(Boolean).join(" ")]),
      ],
    );
  }

  const moves = Object.entries(pack.moves ?? {});
  if (moves.length) {
    b.h(2, "Moves");
    b.table(
      ["Move", "When", "What happens"],
      moves.map(([, m]) => [
        m.label,
        [whenInWords(m.when, n), m.oncePerRun ? `once per ${n.run}` : "", m.available?.length ? `if ${conditionsInWords(pack, m.available)}` : ""].filter(Boolean).join("; "),
        [m.description ?? "", sentence(cap(actionsInWords(pack, m.do))), m.finalizes ? `Closes the ${n.unit}.` : ""].filter(Boolean).join(" "),
      ]),
    );
  }

  if (pack.targeting && pack.targeting.strategy !== "none") {
    b.h(2, "Reaching back");
    b.p(targetingInWords(pack));
  }

  if (pack.triggers?.length) {
    b.h(2, "Always in effect");
    b.list(pack.triggers.map((t) => sentence(cap(triggerInWords(pack, t)))));
  }

  if (pack.endings?.length) {
    b.h(2, `Ending ${an(n.run)}`);
    b.terms(pack.endings.map((e) => ({ term: e.label, text: [e.text ?? "", e.requires?.length ? `Available when ${conditionsInWords(pack, e.requires)}.` : ""].filter(Boolean).join(" ") })));
  }
  return { kind: "rulebook", layout: "book", title: pack.title, subtitle: byline(pack), blocks: b.blocks };
}

export function quickstartDoc(pack: Pack): Doc {
  const n = nouns(pack);
  const b = new Builder();
  b.p(pack.description);
  b.h(2, "What you need");
  b.list(whatYouNeed(pack));
  b.h(2, "The words");
  b.p(`${an(n.run, true)} is one session. It is made of ${n.units}${pack.unit.createsSubject ? `, and each ${n.unit} makes one ${n.subject}` : ""}. Closing a ${n.unit} is called “${n.finalize}”.`);
  b.h(2, `Each ${n.unit}`);
  b.list(flowSteps(pack, { detail: false }), true);
  const d = pack.modes[pack.defaultMode];
  if (d) {
    b.h(2, `Start with ${d.label}`);
    b.p([d.description ?? "", `${cap(modeLength(pack, d))}, ${modePlayers(d)}.`, ...modeExtras(pack, d)].filter(Boolean).join(" "));
    const others = Object.entries(pack.modes).filter(([id]) => id !== pack.defaultMode);
    if (others.length) b.p(`Other ways to play: ${others.map(([, m]) => m.label).join(", ")}. They are in the rulebook.`, "muted");
  }
  if (pack.endings?.length) {
    b.h(2, "When you stop");
    b.terms(pack.endings.map((e) => ({ term: e.label, text: e.text ?? "" })));
  }
  b.p("Every table is on the reference card. Everything else is in the rulebook.", "muted");
  return { kind: "quickstart", layout: "book", title: pack.title, subtitle: "Quick start", blocks: b.blocks };
}

export function referenceDoc(pack: Pack): Doc {
  const n = nouns(pack);
  const b = new Builder();
  b.h(2, `Each ${n.unit}`);
  b.list(flowSteps(pack, { detail: false }), true);
  for (const [, table] of Object.entries(pack.tables)) {
    b.h(2, `${table.title} — ${howConsulted(table).replace(/\.$/, "")}`);
    b.table([table.resolution === "keyed" ? "Key" : "Roll", ""], tableRows(pack, table, { full: true }), true);
  }
  const states = Object.values(pack.states ?? {});
  if (states.length) {
    b.h(2, "States");
    b.table(["", "State"], states.map((s) => [s.short ?? "", `${s.label}${s.description ? ` — ${s.description}` : ""}`]), true);
  }
  const moves = Object.values(pack.moves ?? {});
  if (moves.length) {
    b.h(2, "Moves");
    b.list(moves.map((m) => sentence(`${m.label} (${whenInWords(m.when, n)}${m.oncePerRun ? `, once per ${n.run}` : ""}): ${actionsInWords(pack, m.do)}`)));
  }
  const remember: string[] = [];
  for (const t of pack.triggers ?? []) remember.push(sentence(cap(triggerInWords(pack, t))));
  for (const c of Object.values(pack.counters ?? {})) for (const t of c.triggers ?? []) remember.push(sentence(`${c.label} at ${boundText(t.when)}: ${actionsInWords(pack, t.do)}`));
  for (const m of Object.values(pack.modes)) for (const note of m.notes ?? []) remember.push(`${m.label}: ${note}`);
  if (pack.hierarchy?.length) remember.push(`Precedence: ${pack.hierarchy.join(" > ")}.`);
  if (remember.length) {
    b.h(2, "Frequently forgotten");
    b.list(remember);
  }
  if (pack.endings?.length) {
    b.h(2, "Endings");
    b.list(pack.endings.map((e) => `${e.label}${e.text ? `: ${e.text}` : ""}`));
  }
  return { kind: "reference", layout: "card", title: pack.title, subtitle: `Reference · v${pack.version}`, blocks: b.blocks };
}

export function runlogDoc(pack: Pack): Doc {
  const n = nouns(pack);
  const b = new Builder();
  const head: Array<{ label: string; width?: "short" | "long" | "full"; box?: boolean }> = [{ label: "Date", width: "short" }, { label: "Mode", width: "short" }];
  if (Object.values(pack.modes).some((m) => m.seeded)) head.push({ label: "Seed", width: "short" });
  if (Object.values(pack.modes).some((m) => (m.players?.max ?? 1) > 1)) head.push({ label: "Players", width: "long" });
  for (const deck of Object.values(pack.decks ?? {})) if (deck.kind === "cards" && deck.drawAtStart) head.push({ label: deck.title, width: "short" });
  for (const c of Object.values(pack.counters ?? {}).filter((c) => !c.hidden)) head.push({ label: c.label, width: "short", box: true });
  for (const r of Object.values(pack.resources ?? {})) head.push({ label: r.label, width: "short", box: true });
  head.push({ label: "Page", width: "short" });
  b.form(head);
  b.rule();

  const unitFields: Array<{ label: string; width?: "short" | "long" | "full"; lines?: number }> = [];
  unitFields.push({ label: `${cap(n.unit)} №`, width: "short" });
  if (pack.unit.createsSubject) unitFields.push({ label: `${cap(n.subject)} / states`, width: "long" });
  for (const phase of pack.phases) {
    for (const step of phase.steps) {
      if (step.kind === "rollTable") unitFields.push({ label: pack.tables[step.table]?.title ?? step.table, width: "full", lines: 2 });
    }
  }
  if (pack.journal?.enabled !== false) unitFields.push({ label: "Notes", width: "full", lines: 2 });
  for (let i = 0; i < 6; i++) b.form(unitFields);

  b.rule();
  b.form([{ label: `${cap(n.run)} states`, width: "full", lines: 2 }, { label: "Ending", width: "long" }]);
  return { kind: "runlog", layout: "sheet", title: pack.title, subtitle: `${cap(n.run)} log`, blocks: b.blocks };
}

/* ---- small words --------------------------------------------------------- */

function semanticInWords(s: string): string {
  switch (s) {
    case "blocksEdit":
      return "Nothing about it may be changed.";
    case "makesUntargetable":
      return "Consequences cannot land on it.";
    case "excludesFromResult":
      return "It does not count toward the result.";
    case "locksValue":
      return "Its value is fixed.";
    case "removesFromPlay":
      return "It is out of play.";
    default:
      return s;
  }
}

function whenInWords(when: string | undefined, n: ReturnType<typeof nouns>): string {
  switch (when) {
    case "betweenUnits":
      return `between ${n.units}`;
    case "beforeEnding":
      return `before ending the ${n.run}`;
    default:
      return "any time";
  }
}

function boundText(b: { eq?: number; gte?: number; lte?: number }): string {
  if (b.eq !== undefined) return String(b.eq);
  if (b.gte !== undefined && b.lte !== undefined) return `${b.gte}–${b.lte}`;
  if (b.gte !== undefined) return `${b.gte}+`;
  if (b.lte !== undefined) return `≤${b.lte}`;
  return "";
}

function targetingInWords(pack: Pack): string {
  const n = nouns(pack);
  const t = pack.targeting;
  if (!t) return "";
  switch (t.strategy) {
    case "none":
      return "";
    case "playerChoice":
      return `When a consequence reaches back, you choose which earlier ${n.subject} it lands on.`;
    case "random":
      return `When a consequence reaches back, pick an earlier ${n.subject} at random.`;
    case "oldest":
      return `When a consequence reaches back, it lands on the oldest ${n.subject} still in play.`;
    case "newest":
      return `When a consequence reaches back, it lands on the newest ${n.subject} still in play.`;
    case "anchoredOffset": {
      const bands = t.bands.map((b) => {
        const anchor = b.anchor === "playerChoice" ? "you choose" : `count ${b.direction ?? "before"} from the ${b.anchor}`;
        return `${b.range[0]}–${b.range[1]}: ${anchor}`;
      });
      return `When a roll reaches back, its ones digit says how far: ${bands.join("; ")}. Counting ${t.wraparound === false ? "stops at the end" : "wraps around"}${t.skipIneligible === false ? "" : ` and skips any ${n.subject} that cannot be targeted`}. A 0 lands on the anchor itself.${t.eventFallback ? ` When something other than a roll reaches back, roll ${t.eventFallback.roll} and read it the same way${t.eventFallback.missOn ? `; a ${t.eventFallback.missOn} misses` : ""}.` : ""}`;
    }
  }
}

/* ---- all of them ---------------------------------------------------------- */

export function generateDoc(pack: Pack, kind: DocKind): Doc {
  switch (kind) {
    case "summary":
      return summaryDoc(pack);
    case "rulebook":
      return rulebookDoc(pack);
    case "quickstart":
      return quickstartDoc(pack);
    case "reference":
      return referenceDoc(pack);
    case "runlog":
      return runlogDoc(pack);
  }
}

/* ---- renderers ------------------------------------------------------------ */

const mdEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function toMarkdown(doc: Doc): string {
  const out: string[] = [`# ${doc.title}`];
  if (doc.subtitle) out.push(`*${doc.subtitle}*`);
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
        out.push(`${"#".repeat(block.level)} ${block.text}`);
        break;
      case "paragraph":
        out.push(block.tone === "note" ? `> ${block.text}` : block.text);
        break;
      case "list":
        out.push(block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${item.replace(/\n\s*/g, "  \n   ")}`).join("\n"));
        break;
      case "table":
        out.push([`| ${block.columns.map(mdEscape).join(" | ")} |`, `| ${block.columns.map(() => "---").join(" | ")} |`, ...block.rows.map((r) => `| ${r.map(mdEscape).join(" | ")} |`)].join("\n"));
        break;
      case "terms":
        out.push(block.items.map((t) => `**${t.term}** — ${t.text}`).join("\n\n"));
        break;
      case "form":
        out.push(block.fields.map((f) => `${f.label}: ${f.box ? "[    ]" : "_".repeat(f.width === "full" ? 40 : f.width === "long" ? 24 : 12)}`).join("  \n"));
        break;
      case "rule":
        out.push("---");
        break;
      case "pagebreak":
        out.push("");
        break;
    }
  }
  return `${out.join("\n\n")}\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const multiline = (s: string) => esc(s).replace(/\n/g, "<br>");

const CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #161513; font: 11pt/1.45 Georgia, "Times New Roman", serif; }
main { max-width: 42em; margin: 0 auto; padding: 2.5rem 1.5rem; }
h1 { font-size: 2rem; margin: 0 0 .25rem; line-height: 1.1; }
.subtitle { margin: 0 0 2rem; color: #5b5751; font-style: italic; }
h2 { font-size: 1.25rem; margin: 2rem 0 .5rem; border-bottom: 1px solid #d9d4cb; padding-bottom: .2rem; }
h3 { font-size: 1.05rem; margin: 1.4rem 0 .35rem; }
p { margin: 0 0 .75rem; }
p.muted { color: #5b5751; font-size: .92em; }
p.note { border-left: 3px solid #b9b2a5; padding-left: .75rem; color: #3f3b36; }
ol, ul { margin: 0 0 .9rem; padding-left: 1.4rem; }
li { margin: .2rem 0; white-space: pre-line; }
table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; font-size: .95em; }
th, td { text-align: left; vertical-align: top; padding: .3rem .5rem; border-bottom: 1px solid #e4dfd6; }
th { font-family: system-ui, sans-serif; font-size: .75em; letter-spacing: .04em; text-transform: uppercase; color: #5b5751; }
td:first-child { white-space: nowrap; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .9em; }
table.compact td { padding: .12rem .35rem; font-size: .85em; }
dl { margin: 0 0 1rem; }
dt { font-weight: 700; margin-top: .5rem; }
dd { margin: 0; }
hr { border: 0; border-top: 1px solid #d9d4cb; margin: 1.5rem 0; }
.page { break-after: page; }
.form { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin: .6rem 0 .9rem; font-family: system-ui, sans-serif; font-size: .85em; }
.field { display: flex; align-items: flex-end; gap: .4rem; }
.field .line { display: inline-block; border-bottom: 1px solid #161513; height: 1.3em; }
.field.short .line { width: 7em; } .field.long .line { width: 16em; } .field.full { flex: 1 1 100%; }
.field.full .line { flex: 1; }
.field .lines { flex: 1; display: grid; gap: .55em; }
.field .lines .line { width: 100%; }
.field .box { display: inline-block; width: 2.6em; height: 1.6em; border: 1px solid #161513; }
.layout-card main { max-width: none; column-width: 17em; column-gap: 2rem; padding: 1.25rem; font-size: 9pt; }
.layout-card h1 { column-span: all; font-size: 1.4rem; }
.layout-card .subtitle { column-span: all; margin-bottom: 1rem; }
.layout-card h2 { margin-top: 1rem; font-size: .95rem; break-after: avoid; }
.layout-card table { break-inside: auto; }
.layout-card tr { break-inside: avoid; }
.layout-sheet main { max-width: none; padding: 1.25rem; }
.layout-sheet .form + .form { border-top: 1px dashed #d9d4cb; padding-top: .6rem; }
@media print { main { padding: 0; } @page { margin: 1.6cm; } .layout-card @page { margin: 1cm; } }
`;

export function toHtml(doc: Doc): string {
  const body: string[] = [];
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
        body.push(`<h${block.level}>${esc(block.text)}</h${block.level}>`);
        break;
      case "paragraph":
        body.push(`<p${block.tone ? ` class="${block.tone}"` : ""}>${multiline(block.text)}</p>`);
        break;
      case "list":
        body.push(`<${block.ordered ? "ol" : "ul"}>${block.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`);
        break;
      case "table":
        body.push(
          `<table${block.compact ? ' class="compact"' : ""}><thead><tr>${block.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${block.rows
            .map((r) => `<tr>${r.map((c) => `<td>${multiline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
        );
        break;
      case "terms":
        body.push(`<dl>${block.items.map((t) => `<dt>${esc(t.term)}</dt><dd>${multiline(t.text)}</dd>`).join("")}</dl>`);
        break;
      case "form":
        body.push(
          `<div class="form">${block.fields
            .map((f) => {
              const width = f.width ?? "short";
              const line = f.box ? `<span class="box"></span>` : f.lines && f.lines > 1 ? `<span class="lines">${'<span class="line"></span>'.repeat(f.lines)}</span>` : `<span class="line"></span>`;
              return `<span class="field ${width}"><span class="label">${esc(f.label)}</span>${line}</span>`;
            })
            .join("")}</div>`,
        );
        break;
      case "rule":
        body.push("<hr>");
        break;
      case "pagebreak":
        body.push('<div class="page"></div>');
        break;
    }
  }
  return `<!doctype html>
<html lang="en" class="layout-${doc.layout}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}${doc.subtitle ? ` — ${esc(doc.subtitle)}` : ""}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(doc.title)}</h1>
${doc.subtitle ? `<p class="subtitle">${esc(doc.subtitle)}</p>` : ""}
${body.join("\n")}
</main>
</body>
</html>
`;
}

/** Everything a pack's text could be, keyed by kind; a caller picks what it may show. */
export function generateDocs(pack: Pack): Record<DocKind, Doc> {
  return {
    summary: summaryDoc(pack),
    rulebook: rulebookDoc(pack),
    quickstart: quickstartDoc(pack),
    reference: referenceDoc(pack),
    runlog: runlogDoc(pack),
  };
}

/** The phase list, for anything that wants the flow alone. */
export function phaseLabels(pack: Pack): string[] {
  return pack.phases.map((p: Phase) => p.label);
}
