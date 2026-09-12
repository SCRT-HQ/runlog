import { useState } from "react";
import type { Diagnostic, Pack, Table } from "@runlog/rules-schema";
import { describeRoll, entryKeys, resolveRoll, type RollResult } from "../rolling.ts";
import { DiceTray } from "../dice/DiceTray.tsx";

/**
 * A pack as the engine holds it: every table, the flow, the modes.
 *
 * It sat on a page of its own beside the documents, where a player met it
 * on the way to a rule. The documents are the drawer's now, reachable from
 * the shelf, the marketplace and a run, and this was never for a player: it
 * is for whoever is checking a pack against its source, which is what the
 * Designer is. So it stands here, beside the pack's paper and its signing,
 * with every table rollable to see what it does.
 */
export function StructurePanel({
  pack,
  warnings,
  random,
}: {
  pack: Pack;
  warnings: Diagnostic[];
  random: () => () => number;
}) {
  const v = pack.vocabulary;
  return (
    <>
      <section className="hero">
        <div>
          <h2>{pack.title}</h2>
          <p className="muted">{pack.description}</p>
          <div className="chips">
            <span className="chip v">v{pack.version}</span>
            <span className={`chip ${pack.license.redistributable ? "ok" : "warn"}`}>
              {pack.license.id}
              {!pack.license.redistributable && " · private"}
            </span>
            {pack.capabilities.map((c) => (
              <span key={c} className="chip cap">
                {c}
              </span>
            ))}
          </div>
          {pack.license.text && <pre className="licenseText">{pack.license.text}</pre>}
          {!pack.license.redistributable && (
            <p className="notice">
              Marked non-redistributable. Exports meant for other people carry roll results
              and references, never this pack&rsquo;s text.
            </p>
          )}
        </div>
        <dl className="vocab">
          <div>
            <dt>Run</dt>
            <dd>{v.run.one}</dd>
          </div>
          <div>
            <dt>Unit</dt>
            <dd>{v.unit.one}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{v.subject.one}</dd>
          </div>
          <div>
            <dt>Close</dt>
            <dd>{v.finalize}</dd>
          </div>
        </dl>
      </section>

      {warnings.length > 0 && (
        <section className="panel warnings">
          <h3>{warnings.length} warning(s)</h3>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="code">{w.code}</span> {w.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="columns">
        <div className="col wide">
          <h3 className="sectionTitle">Tables</h3>
          {Object.entries(pack.tables).map(([id, table]) => (
            <TableCard key={id} id={id} table={table} pack={pack} random={random} />
          ))}
        </div>

        <div className="col">
          <Flow pack={pack} />
          <Boxes pack={pack} />
        </div>
      </div>
    </>
  );
}

function TableCard({
  id,
  table,
  pack,
  random,
}: {
  id: string;
  table: Table;
  pack: Pack;
  random: () => () => number;
}) {
  const [open, setOpen] = useState(false);
  const [roll, setRoll] = useState<RollResult | null>(null);
  const [rollId, setRollId] = useState(0);
  /**
   * What the player is allowed to see yet.
   *
   * The result is decided the instant Roll is pressed, but revealing it while
   * the dice are still in the air gives the throw away. `revealed` lags behind
   * `roll` until the tray says the last die has stopped.
   */
  const [revealed, setRevealed] = useState<RollResult | null>(null);
  const keys = entryKeys(table);

  return (
    <section className={`panel table ${open ? "open" : ""}`}>
      <header onClick={() => setOpen((o) => !o)}>
        <div>
          <h4>
            {table.title} <span className="id">{id}</span>
          </h4>
          <p className="muted">{table.description}</p>
        </div>
        <div className="tableMeta">
          <span className="chip kind">{table.resolution}</span>
          <span className="dice">{describeRoll(table)}</span>
          <button
            className="roll"
            onClick={(e) => {
              e.stopPropagation();
              // The value is decided here, before anything moves. The tray
              // only ever settles onto a result that already exists.
              const result = resolveRoll(table, pack, random());
              setRoll(result);
              setRollId((n) => n + 1);
              setOpen(true);
              // A draw with no dice has nothing to wait for.
              setRevealed(result.dice.length === 0 ? result : null);
            }}
          >
            Roll
          </button>
        </div>
      </header>

      {roll && roll.dice.length > 0 && (
        <DiceTray dice={roll.dice} rollId={rollId} onSettled={() => setRevealed(roll)} />
      )}

      {revealed && (
        <div className="rollResult">
          <span className="headline">{revealed.headline}</span>
          {/* The derivation is always shown. A tool that hands you a verdict
              with no visible reasoning is the thing players distrust. */}
          <span className="working">{revealed.working}</span>
        </div>
      )}

      {open && (
        <ol className="entries">
          {table.entries.map((entry, i) => {
            const hit = revealed?.entryId === entry.id;
            return (
              <li key={entry.id} className={hit ? "hit" : ""}>
                <span className="key">{keys[i]}</span>
                <div>
                  {entry.title && <strong>{entry.title}</strong>}
                  <p>{entry.text}</p>
                  <div className="entryTags">
                    {entry.grants?.map((g) => (
                      <span key={g} className="chip state">
                        {pack.states?.[g]?.label ?? g}
                      </span>
                    ))}
                    {entry.triggers?.map((t, ti) => (
                      <span key={ti} className="chip trig">
                        {t.on}
                      </span>
                    ))}
                    {entry.requires && <span className="chip req">conditional</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Flow({ pack }: { pack: Pack }) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Flow <span className="muted">per {pack.vocabulary.unit.one.toLowerCase()}</span>
      </h3>
      <ol className="flow">
        {pack.phases.map((phase) => (
          <li key={phase.id}>
            <strong>{phase.label}</strong>
            {phase.skipWhen && <span className="chip skip">conditional</span>}
            <ul>
              {phase.steps.map((step, i) => (
                <li key={i} className="step">
                  <span className="chip kindSm">{step.kind}</span>
                  {"label" in step && step.label ? step.label : ""}
                  {step.kind === "rollTable" && (
                    <span className="muted"> → {pack.tables[step.table]?.title ?? step.table}</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Boxes({ pack }: { pack: Pack }) {
  const states = Object.entries(pack.states ?? {});
  const counters = Object.entries(pack.counters ?? {});
  const resources = Object.entries(pack.resources ?? {});
  const decks = Object.entries(pack.decks ?? {});

  return (
    <>
      {resources.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">Resources</h3>
          {resources.map(([id, r]) => (
            <div key={id} className="row">
              <strong>{r.label}</strong>
              <span className="muted">
                {r.initial} · {r.min}-{r.max ?? "∞"} · {r.display}
              </span>
            </div>
          ))}
        </section>
      )}

      {counters.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">Counters</h3>
          {counters.map(([id, c]) => (
            <div key={id} className="row">
              <strong>{c.label}</strong>
              <span className="muted">
                {c.hidden && "hidden · "}
                {c.triggers?.length
                  ? `fires at ${c.triggers.map((t) => t.when.gte ?? t.when.eq).join(", ")}`
                  : "tally only"}
              </span>
            </div>
          ))}
        </section>
      )}

      {states.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">States</h3>
          {states.map(([id, s]) => (
            <div key={id} className="row">
              <span className="chip state">{s.short ?? s.label}</span>
              <strong>{s.label}</strong>
              <span className="muted">{s.semantics?.join(", ") ?? "label only"}</span>
            </div>
          ))}
        </section>
      )}

      {decks.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">Decks</h3>
          {decks.map(([id, d]) => (
            <div key={id} className="row">
              <strong>{d.title}</strong>
              <span className="muted">
                {d.kind === "cards" ? `${d.cards.length} cards` : "standard 52"} · draw{" "}
                {d.drawAtStart} at start
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <h3 className="sectionTitle">
          Targeting <span className="muted">how consequences reach back</span>
        </h3>
        <p className="muted small">
          {pack.targeting
            ? `${pack.targeting.strategy}`
            : "none, nothing in this game reaches backwards"}
        </p>
      </section>

      <section className="panel">
        <h3 className="sectionTitle">Modes</h3>
        {Object.entries(pack.modes).map(([id, m]) => (
          <div key={id} className="row">
            <strong>{m.label}</strong>
            <span className="muted">
              {m.units?.fixed
                ? `${m.units.fixed} fixed`
                : m.units?.roll
                  ? `roll ${m.units.roll}`
                  : m.units
                    ? `${m.units.min ?? "?"}-${m.units.max ?? "?"}`
                    : "open"}
              {m.seeded && " · seeded"}
              {(m.players?.max ?? 1) > 1 && ` · ${m.players?.max} players`}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
