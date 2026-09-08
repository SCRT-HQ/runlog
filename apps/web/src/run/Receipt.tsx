import { useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import type { ResolvedOutcome } from "@runlog/engine";
import { Die } from "../dice/Die.tsx";
import type { RolledDie } from "../rolling.ts";

/**
 * What the dice did, held on screen until the player has read it.
 *
 * The engine answers a roll the instant the dice settle, and the step moves
 * on — which is right for the game and wrong for the person, who saw the
 * dice vanish and had to find the result in the log. The receipt is the
 * moment between: the dice as they landed, the total, and what the table said
 * about it, raised like a step and staying put until "Carry on".
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
  /** Everything the answer resolved, in order. */
  outcomes: ResolvedOutcome[];
}

export function Receipt({
  receipt,
  pack,
  onDismiss,
  onDrawAgain,
  onKeepRolling,
}: {
  receipt: RollReceipt;
  pack: Pack;
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
  const hasThrow = receipt.total !== null;
  const [why, setWhy] = useState<string | null>(null);
  return (
    <section className="panel runStep receipt" aria-live="polite">
      <h3 className="sectionTitle">{receipt.label ?? "What the dice did"}</h3>

      {hasThrow && (
        <div className="throw">
          {receipt.dice && receipt.dice.length > 0 && (
            <div className="tray">
              {receipt.dice.map((die, i) => (
                <Die
                  key={i}
                  faces={die.faces}
                  display={die.display}
                  label={die.label}
                  variant={die.variant}
                />
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

      {receipt.outcomes.length === 0 ? (
        <p className="muted">Nothing on the table for that. It is recorded.</p>
      ) : (
        receipt.outcomes.map((o, i) => {
          const table = pack.tables[o.table];
          const entry = table?.entries.find((e) => e.id === o.entryId);
          const hit = o.targetSubject !== null;
          return (
            <div key={i} className={`result ${hit ? "heat" : ""}`}>
              <span className="band">
                {table?.title ?? o.table}
                {hit && ` — hit ${v.subject.one.toLowerCase()} #${o.targetSubject}`}
              </span>
              <p className="text">{entry?.title ?? entry?.text ?? o.entryId}</p>
              {entry?.title && entry.text && <p className="muted">{entry.text}</p>}
            </div>
          );
        })
      )}

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
    </section>
  );
}
