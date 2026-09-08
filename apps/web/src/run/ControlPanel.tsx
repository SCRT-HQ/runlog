import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Pack } from "@runlog/rules-schema";
import { constraintsFor, type RunState } from "@runlog/engine";
import type { RolledDie } from "../rolling.ts";
import type { RollReceipt } from "./Receipt.tsx";
import { Checklist, checklistDone } from "./Checklist.tsx";
import { RequestPanel } from "./RequestPanel.tsx";
import { ClockPanel } from "./ClockPanel.tsx";
import { ticksFor } from "./stepChecks.ts";
import { nudgeFirstUnticked } from "./nudge.ts";
import { Constraints } from "./Constraints.tsx";
import type { useRun, ActiveStep } from "./useRun.ts";

/**
 * The run's controls in a small window that floats above everything.
 *
 * A streamer's screen is the game, the capture software and the chat;
 * the run's page is behind all of it. This window is the one they need in
 * front, and it is meant to run the whole thing: the current step, whatever
 * the engine is waiting on, the last receipt, between-units, what is owed,
 * the moves on offer, the clock, undo. It is drawn into a window the browser
 * keeps on top — Chrome and Edge's document picture-in-picture, the same
 * mechanism a floating video uses — and it is still this page's React tree,
 * so it presses the same functions the page does. Nothing here writes on its
 * own; the page stays the one writer of the run.
 *
 * Kept a remote, not a second copy of the screen: no side column, no log, no
 * board editing. Everything here either is, or directly reuses, what the
 * step cards already do — `RequestPanel`, `Checklist`, `ClockPanel` — so the
 * remote cannot say something different from the page.
 */

/** Whether this browser can float a window above the others. */
export function canFloat(): boolean {
  return typeof window !== "undefined" && typeof window.documentPictureInPicture?.requestWindow === "function";
}

/**
 * Ask for the window. Called from the press itself, since the browser
 * grants a floating window only to a person's gesture, and asked for
 * only once: a second ask while one is open is refused.
 */
export function openControlsWindow(): Promise<Window> {
  const pipApi = window.documentPictureInPicture;
  if (!pipApi) return Promise.reject(new Error("this browser cannot float a window"));
  if (pipApi.window) return Promise.resolve(pipApi.window);
  return pipApi.requestWindow({ width: 380, height: 480 });
}

export interface ControlAnswer {
  (key: string, value: string | number | boolean, machineRolled?: boolean, dice?: RolledDie[], seed?: number): void;
}

export function ControlPanel({
  win,
  pack,
  run,
  state,
  receipt,
  onCarryOn,
  onAnswer,
  onDrawAgain,
  onKeepRolling,
  onClose,
}: {
  /** The floating window, already opened by the press; see openControlsWindow. */
  win: Window;
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  receipt: RollReceipt | null;
  onCarryOn: () => void;
  /** Answer a roll, an ask, a prompt or a target the machine is waiting on. */
  onAnswer: ControlAnswer;
  /** Unmake the last draw and roll it again; offered only where the page offers it. */
  onDrawAgain?: (reason?: string) => void;
  /** Machine-roll from here on; offered only where the page offers it. */
  onKeepRolling?: () => void;
  /** The person closed the window. */
  onClose: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // The window is dressed once in this page's stylesheets and theme, and
  // given a place to draw into. Nothing here closes it: the person does,
  // and the page hears of it.
  useEffect(() => {
    const doc = win.document;
    let mount = doc.querySelector<HTMLElement>(".pipMount");
    if (!mount) {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          if (sheet.href) {
            const link = doc.createElement("link");
            link.rel = "stylesheet";
            link.href = sheet.href;
            doc.head.appendChild(link);
          } else {
            const style = doc.createElement("style");
            style.textContent = Array.from(sheet.cssRules)
              .map((r) => r.cssText)
              .join("\n");
            doc.head.appendChild(style);
          }
        } catch {
          /* a cross-origin sheet cannot be read; nothing of ours is */
        }
      }
      const theme = document.documentElement.dataset["theme"];
      if (theme) doc.documentElement.dataset["theme"] = theme;
      doc.documentElement.dataset["pip"] = "controls";
      doc.title = `${pack.title} · controls`;
      mount = doc.createElement("div");
      mount.className = "pipMount";
      doc.body.appendChild(mount);
    }
    setHost(mount);
    win.addEventListener("pagehide", onClose);
    return () => win.removeEventListener("pagehide", onClose);
  }, [win, pack.title, onClose]);

  if (!host) return null;
  return createPortal(
    <RemoteControls pack={pack} run={run} state={state} receipt={receipt} onCarryOn={onCarryOn} onAnswer={onAnswer} onDrawAgain={onDrawAgain} onKeepRolling={onKeepRolling} />,
    host,
  );
}

/**
 * The controls themselves, apart from the window that floats them: exported
 * on its own so it can be rendered — and tested — without a real
 * document-picture-in-picture window behind it.
 */
export function RemoteControls({
  pack,
  run,
  state,
  receipt,
  onCarryOn,
  onAnswer,
  onDrawAgain,
  onKeepRolling,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  receipt: RollReceipt | null;
  onCarryOn: () => void;
  onAnswer: ControlAnswer;
  onDrawAgain?: (reason?: string) => void;
  onKeepRolling?: () => void;
}) {
  const v = pack.vocabulary;
  const request = run.pending?.request;
  const active = run.activeStep;
  const unitWord = v.unit.one;
  const entryText = (table: string, entryId: string) => {
    const t = pack.tables[table];
    const e = t?.entries.find((x) => x.id === entryId);
    return { where: t?.title ?? table, text: e?.title ?? e?.text ?? entryId };
  };
  const editable = !run.readOnly;
  // The one slot where the step, the request, the receipt and between-units
  // take turns: at most one of them is true at a time, in the order the
  // remote lists them.
  const showStep = editable && !request && !receipt && state.status === "active" && state.unit > 0 && !!active;
  const showRequest = editable && !!request;
  const showBetween = editable && !request && !receipt && state.status === "active" && !active && state.unit > 0;
  const showFirstUnit = editable && !request && !receipt && state.status === "active" && state.unit === 0;

  return (
    <div className="pipPanel">
      <header className="pipHead">
        <strong>{pack.title}</strong>
        <span className="muted small">
          {unitWord} {state.unit || "—"}
          {state.name ? ` · ${state.name}` : ""}
        </span>
      </header>

      {editable && !request && !receipt && state.status === "ended" && (
        <p className="muted small">This {v.run.one.toLowerCase()} has ended.</p>
      )}

      {/* 1. The step: what the page's current card offers. */}
      {showStep && active && <RemoteStep pack={pack} run={run} state={state} active={active} />}

      {/* 2. What the game is waiting on. */}
      {showRequest && request && (
        <RequestPanel request={request} pack={pack} state={state} onAnswer={onAnswer} onCancel={run.abandonPending} />
      )}

      {/* 3. The receipt, as today. */}
      {receipt && (
        <section className="pipReceipt" aria-live="polite">
          {receipt.total !== null && (
            <div className="rollTotal">
              <span className="big">{receipt.total}</span>
              {receipt.notation && <span className="how">{receipt.notation}</span>}
            </div>
          )}
          <ul className="pipOutcomes">
            {receipt.outcomes.map((o, i) => {
              const { where, text } = entryText(o.table, o.entryId);
              return (
                <li key={i} className={o.targetSubject !== null ? "heat" : ""}>
                  <span className="where">
                    {where}
                    {o.targetSubject !== null && ` — ${v.subject.one.toLowerCase()} #${o.targetSubject}`}
                  </span>
                  <span>{text}</span>
                </li>
              );
            })}
          </ul>
          {editable && (
            <div className="padRow">
              <button className="primary" onClick={onCarryOn}>
                Carry on
              </button>
              {onKeepRolling && (
                <button className="ghost small" onClick={onKeepRolling} title="Roll for you from here on">
                  Keep rolling for me
                </button>
              )}
              {onDrawAgain && (
                <button className="ghost small" onClick={() => onDrawAgain()} title="Unmake this draw and roll again">
                  Can't do this one
                </button>
              )}
            </div>
          )}
          {!editable && (
            <div className="padRow">
              <button className="primary" onClick={onCarryOn}>
                Carry on
              </button>
            </div>
          )}
        </section>
      )}

      {/* 4. Between units. */}
      {showBetween && <RemoteBetweenUnits pack={pack} run={run} state={state} />}
      {showFirstUnit && (
        <section className="pipSection">
          <h3 className="sectionTitle">Ready</h3>
          <button className="primary big" onClick={run.enterUnit}>
            Enter {unitWord} 1
          </button>
        </section>
      )}

      {/* 5. Owed, and moves. */}
      {editable && (run.due.length > 0 || run.notes.length > 0) && <RemoteOwed run={run} />}
      {editable && run.moves.length > 0 && <RemoteMoves run={run} />}

      {/* 6. The clock. */}
      {state.unit > 0 && <ClockPanel pack={pack} run={run} state={state} />}

      {/* 7. Undo, last. */}
      {editable && (
        <button className="ghost tiny" onClick={run.undo} disabled={!run.canUndo}>
          Undo
        </button>
      )}
    </div>
  );
}

/** A small heading in the page's own style, over one section of controls. */
function PipSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pipSection runStep">
      <h3 className="sectionTitle">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What the page's current step card offers, compactly.
 *
 * A `rollTable` step is a single button here, exactly as on the page: the
 * roll itself — the pad, "Roll for me", the table toggle — is what the game
 * is then waiting on, covered by reusing `RequestPanel` rather than a second
 * copy of it.
 */
function RemoteStep({
  pack,
  run,
  state,
  active,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  active: ActiveStep;
}) {
  const { phase, step, index } = active;
  const [declared, setDeclared] = useState("");
  const key = `${phase.id}#${index}`;
  const ticked = useMemo(() => ticksFor(state, key), [state, key]);
  const tick = (keys: string[], on: boolean, tally?: string) => run.check(key, keys, on, tally);

  switch (step.kind) {
    case "rollTable": {
      const table = pack.tables[step.table];
      return (
        <PipSection title={phase.label}>
          <button
            className="primary big"
            onClick={() =>
              run.begin({ kind: "table", tableId: step.table, keyPrefix: `u${state.unit}:${key}`, label: table?.title ?? step.table, completes: { phase, index } })
            }
          >
            {table?.title ?? "Roll"}
          </button>
        </PipSection>
      );
    }

    case "declareSubject": {
      const constraints = constraintsFor(pack, state, step.constrainedBy);
      return (
        <PipSection title={step.label ?? `Declare the ${pack.vocabulary.subject.one}`}>
          <Constraints lines={constraints} />
          <div className="padRow">
            <input
              className="textInput"
              placeholder={`What is this ${pack.vocabulary.subject.one.toLowerCase()}?`}
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && declared && run.declareSubject(phase, index, declared)}
            />
            <button className="primary" disabled={!declared} onClick={() => run.declareSubject(phase, index, declared)}>
              Declare
            </button>
          </div>
        </PipSection>
      );
    }

    case "manual": {
      const list = step.checklist ?? [];
      const done = checklistDone(list, pack, state, ticked);
      const constraints = constraintsFor(pack, state, step.constrainedBy);
      return (
        <PipSection title={step.label}>
          <Constraints lines={constraints} />
          {list.length > 0 && <Checklist items={list} pack={pack} state={state} ticked={ticked} onToggle={tick} />}
          <button className="primary big" onClick={(e) => (done ? run.completeStep(phase, index) : nudgeFirstUnticked(e.currentTarget))}>
            {done ? "Done" : "Tick what you honored"}
          </button>
        </PipSection>
      );
    }

    case "actions":
      return (
        <PipSection title={phase.label}>
          <button
            className="primary big"
            onClick={() =>
              run.begin({ kind: "actions", actions: step.do, keyPrefix: `u${state.unit}:${key}`, label: phase.label, completes: { phase, index } })
            }
          >
            Continue
          </button>
        </PipSection>
      );

    case "finalizeUnit": {
      const confirmations = step.confirm ?? [];
      const blocked = run.blockingObligations;
      const done = checklistDone(confirmations, pack, state, ticked);
      return (
        <PipSection title={step.label ?? pack.vocabulary.finalize}>
          {blocked.length > 0 && <p className="muted small">Settle what is owed first.</p>}
          {confirmations.length > 0 && <Checklist items={confirmations} pack={pack} state={state} ticked={ticked} onToggle={tick} />}
          <button
            className="primary big"
            disabled={blocked.length > 0}
            onClick={(e) => (done ? run.finalizeUnit(phase, index) : nudgeFirstUnticked(e.currentTarget))}
          >
            {blocked.length > 0 ? "Settle first" : done ? pack.vocabulary.finalize : "Tick what you honored"}
          </button>
        </PipSection>
      );
    }
  }
}

/** Enter the next unit, or end here: the same choice `BetweenUnits` offers on the page. */
function RemoteBetweenUnits({ pack, run, state }: { pack: Pack; run: ReturnType<typeof useRun>; state: RunState }) {
  const v = pack.vocabulary;
  const [note, setNote] = useState(state.journal[state.unit] ?? "");
  const [ending, setEnding] = useState<string | null>(null);
  const kept = note.trim() !== "" && state.journal[state.unit] === note;
  const keep = () => note.trim() && !kept && run.writeJournal(state.unit, note);

  return (
    <PipSection title={`${v.unit.one} ${state.unit} closed`}>
      <button className="primary big" onClick={run.enterUnit}>
        Enter {v.unit.one} {state.unit + 1}
      </button>

      {pack.journal?.enabled && (
        <div className="padRow">
          <input
            className="textInput"
            value={note}
            placeholder={pack.journal.prompt ?? "Anything worth remembering?"}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && keep()}
            onBlur={keep}
          />
          <button className={kept ? "ghost saved" : "ghost"} disabled={!note.trim() || kept} onClick={keep}>
            {kept ? "Saved" : "Save"}
          </button>
        </div>
      )}

      {run.canEnd.ok && (
        <div className="pipChoices">
          {(pack.endings ?? [{ id: "done", label: "End", text: "" }]).map((e) => (
            <button key={e.id} className={`ghost small ${ending === e.id ? "on" : ""}`} onClick={() => setEnding(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
      )}
      {run.canEnd.ok && ending && (
        <button className="primary" onClick={() => run.endRun(ending)}>
          End the {v.run.one.toLowerCase()}
        </button>
      )}
    </PipSection>
  );
}

/** Results that reach forward in time, with their buttons: `Obligations` on the page. */
function RemoteOwed({ run }: { run: ReturnType<typeof useRun> }) {
  return (
    <PipSection title="Owed">
      {run.due.map((o) => (
        <div key={o.id} className="row spread">
          <span>{o.text}</span>
          <button className="primary tiny" onClick={() => run.resolveObligation(o.id, o.text)}>
            Resolve
          </button>
        </div>
      ))}
      {run.notes.map((o) => (
        <div key={o.id} className="row spread">
          <span>{o.text}</span>
          <button className="ghost tiny" onClick={() => run.resolveObligation(o.id, o.text)}>
            Done
          </button>
        </div>
      ))}
    </PipSection>
  );
}

/** Moves the player may take, as plain buttons: only the label, the description on the title. */
function RemoteMoves({ run }: { run: ReturnType<typeof useRun> }) {
  const owed = run.blockingObligations.length;
  return (
    <PipSection title="Your move">
      <div className="pipChoices">
        {run.moves.map(({ id, move }) => (
          <button
            key={id}
            className="ghost small"
            disabled={Boolean(move.finalizes) && owed > 0}
            title={move.description}
            onClick={() => run.takeMove(id, move.label)}
          >
            {move.label}
          </button>
        ))}
      </div>
    </PipSection>
  );
}
