import { useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import type { ResolvedOutcome } from "@runlog/engine";
import { parseDice } from "@runlog/rules-schema";
import { Die } from "../dice/Die.tsx";
import type { RolledDie } from "../rolling.ts";
import { lineFor, tableLines } from "./tableLook.ts";

/**
 * What the dice did, held on screen until the player has read it.
 *
 * The engine answers a roll the instant the dice settle, and the step moves
 * on, which is right for the game and wrong for the person, who saw the
 * dice vanish and had to find the result in the log. The receipt is the
 * moment between: the dice as they landed, the total, and what the table said
 * about it, raised like a step and staying put until "Carry on".
 *
 * A step can roll more than once: a d100 that sends the player to a d6. The
 * rolls stay together as they land, each with its line, and the next roll's
 * keypad comes underneath. One "Carry on" closes the whole step, so nothing
 * is replaced before it has been read.
 *
 * A receipt can also carry no dice at all. Typed-in physical dice, and rolls
 * the machine made on its own, still produced an outcome worth reading.
 */
export interface RollReceipt {
  /** The dice as they settled, when there were any to show. */
  dice: RolledDie[] | null;
  total: number | null;
  label: string | null;
  notation: string | null;
  machineRolled: boolean;
  /** How the dice flew, for anyone watching to see the same throw. */
  seed?: number;
  /**
   * The table the roll was for, when it was a table's own roll. A step
   * that rolls several times resolves them together at its end, so the
   * early throws have no outcome yet; the table says where each lands.
   */
  table?: string | null;
  /** Everything the answer resolved, in order. */
  outcomes: ResolvedOutcome[];
}

/** Where a throw lands on its table, read from the table itself, before the step has resolved it. */
function landing(pack: Pack, receipt: RollReceipt): { table: string; title: string; text?: string } | null {
  if (!receipt.table || receipt.total === null) return null;
  const table = pack.tables[receipt.table];
  if (!table) return null;
  let dice: { min: number; max: number } | null = null;
  try {
    dice = receipt.notation ? parseDice(receipt.notation) : null;
  } catch {
    dice = null;
  }
  const lines = tableLines(table, dice);
  const id = lineFor(lines, table, receipt.total);
  const entry = id ? table.entries.find((e) => e.id === id) : undefined;
  if (!entry) return null;
  return { table: table.title, title: entry.title ?? entry.text, ...(entry.title && entry.text ? { text: entry.text } : {}) };
}

export function Receipt({
  receipts,
  pack,
  nameOf,
  settled,
  onDismiss,
  onDrawAgain,
  onKeepRolling,
}: {
  /** The step's rolls so far, oldest first. */
  receipts: RollReceipt[];
  pack: Pack;
  /** "hit Track 2 (bass)" for a result that reached a subject; without it, the number alone. */
  nameOf?: (subjectId: number) => string;
  /** The step is done: nothing more is asked, and Carry on closes it. */
  settled: boolean;
  onDismiss: () => void;
  /** When the draw can be unmade and taken again: a result that cannot be done today. */
  onDrawAgain?: (reason?: string) => void;
  /**
   * After a roll the machine made on request: keep making them. The choice
   * is offered where the roll happened, not in a toolbar before the run.
   */
  onKeepRolling?: () => void;
}) {
  const v = pack.vocabulary;
  const [why, setWhy] = useState<string | null>(null);
  const first = receipts[0];
  const title =
    receipts.length === 1 ? (first?.label ?? "What the dice did") : settled ? "What the dice did" : "What the dice did, so far";
  return (
    <section className={`panel runStep receipt${settled ? "" : " open"}`} aria-live="polite">
      <h3 className="sectionTitle">{title}</h3>

      {receipts.map((receipt, n) => {
        const hasThrow = receipt.total !== null;
        return (
          <div key={n} className="entry">
            {receipts.length > 1 && receipt.label && <span className="entryLabel">{receipt.label}</span>}
            {hasThrow && (
              <div className="throw">
                {receipt.dice && receipt.dice.length > 0 && (
                  <div className="tray">
                    {receipt.dice.map((die, i) => (
                      <Die key={i} faces={die.faces} display={die.display} label={die.label} variant={die.variant} />
                    ))}
                  </div>
                )}
                <div className="rollTotal">
                  <span className="big">{receipt.total}</span>
                  <span className="how">
                    {receipt.notation}
                    {receipt.machineRolled ? ", rolled for you" : ", your dice"}
                  </span>
                </div>
              </div>
            )}

            {receipt.outcomes.length === 0
              ? hasThrow &&
                (() => {
                  const lands = landing(pack, receipt);
                  return lands ? (
                    <div className="result provisional">
                      <span className="band">{lands.table}</span>
                      <p className="text">{lands.title}</p>
                      {lands.text && <p className="muted">{lands.text}</p>}
                      {!settled && <p className="muted small">Where it lands. The step settles what stays once every roll is in.</p>}
                    </div>
                  ) : (
                    <p className="muted">Nothing on the table for that. It is recorded.</p>
                  );
                })()
              : receipt.outcomes.map((o, i) => {
                  const table = pack.tables[o.table];
                  const entry = table?.entries.find((e) => e.id === o.entryId);
                  const hit = o.targetSubject !== null;
                  return (
                    <div key={i} className={`result ${hit ? "heat" : ""}`}>
                      <span className="band">
                        {table?.title ?? o.table}
                        {hit && ` - ${nameOf ? nameOf(o.targetSubject!) : `hit ${v.subject.one.toLowerCase()} #${o.targetSubject}`}`}
                      </span>
                      <p className="text">{entry?.title ?? entry?.text ?? o.entryId}</p>
                      {entry?.title && entry.text && <p className="muted">{entry.text}</p>}
                    </div>
                  );
                })}
          </div>
        );
      })}

      {settled ? (
        <>
          <div className="padRow">
            <button className="primary" onClick={onDismiss} autoFocus>
              Carry on
            </button>
            {onKeepRolling && (
              <button className="ghost" onClick={onKeepRolling} title="Roll for you from here on; the log still says which rolls were the machine's">
                Keep rolling for me
              </button>
            )}
            {onDrawAgain && why === null && (
              <button className="ghost" onClick={() => setWhy("")} title="Unmake this draw and roll again; the log says you did">
                Can't do this one
              </button>
            )}
          </div>
          {onDrawAgain && why !== null && (
            <form
              className="drawAgain"
              onSubmit={(e) => {
                e.preventDefault();
                onDrawAgain(why);
              }}
            >
              <label>
                <span className="muted small">Why, in a few words (optional). The log keeps it.</span>
                <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="no partner today" autoFocus maxLength={120} />
              </label>
              <div className="padRow">
                <button type="submit" className="primary">
                  Draw again
                </button>
                <button type="button" className="ghost" onClick={() => setWhy(null)}>
                  Keep it
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <p className="muted small stays">These stay until the step is done. The next roll is below.</p>
      )}
    </section>
  );
}
