import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { rollDice, type Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { toDisplayDice, type RolledDie } from "../rolling.ts";
import type { RollReceipt } from "./Receipt.tsx";
import { checklistDone } from "./Checklist.tsx";
import type { useRun } from "./useRun.ts";

/**
 * The run's controls in a small window that floats above everything.
 *
 * A streamer's screen is the game, the capture software and the chat;
 * the run's page is behind all of it. This is the one panel they need in
 * front: the next move, the last result, undo. It is drawn into a window
 * the browser keeps on top — Chrome and Edge's document picture-in-picture,
 * the same mechanism a floating video uses — and it is still this page's
 * React tree, so it presses the same functions the page does. Nothing
 * here writes on its own; the page stays the one writer of the run.
 *
 * Anything with typing or a list of boxes stays on the page: this is the
 * remote, not a second copy of the screen.
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

export function ControlPanel({
  win,
  pack,
  run,
  state,
  receipt,
  onCarryOn,
  onRoll,
  onClose,
}: {
  /** The floating window, already opened by the press; see openControlsWindow. */
  win: Window;
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  receipt: RollReceipt | null;
  onCarryOn: () => void;
  /** Answer a roll the game is waiting on, thrown by the machine. */
  onRoll: (key: string, total: number, dice: RolledDie[], seed: number) => void;
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
  return createPortal(<Controls pack={pack} run={run} state={state} receipt={receipt} onCarryOn={onCarryOn} onRoll={onRoll} />, host);
}

function Controls({
  pack,
  run,
  state,
  receipt,
  onCarryOn,
  onRoll,
}: {
  pack: Pack;
  run: ReturnType<typeof useRun>;
  state: RunState;
  receipt: RollReceipt | null;
  onCarryOn: () => void;
  onRoll: (key: string, total: number, dice: RolledDie[], seed: number) => void;
}) {
  const v = pack.vocabulary;
  const request = run.pending?.request;
  const active = run.activeStep;
  const unitWord = v.unit.one;
  const latest = [...state.outcomes].reverse().slice(0, 3);
  const entryText = (table: string, entryId: string) => {
    const t = pack.tables[table];
    const e = t?.entries.find((x) => x.id === entryId);
    return { where: t?.title ?? table, text: e?.title ?? e?.text ?? entryId };
  };

  /** The one thing to press, for where the run stands. */
  const move = (): { label: string; act: () => void; disabled?: boolean; note?: string } | { note: string } => {
    if (state.status === "ended") return { note: `This ${v.run.one.toLowerCase()} has ended.` };
    if (receipt) return { label: "Carry on", act: onCarryOn };
    if (request) {
      if (request.kind === "roll") {
        return {
          label: `Roll ${request.dice}`,
          act: () => {
            const { total, dice } = rollDice(request.dice, Math.random);
            onRoll(request.key, total, toDisplayDice(request.dice, dice, total), Math.floor(Math.random() * 4294967296));
          },
        };
      }
      return { note: "The game is asking something; answer it on the page." };
    }
    if (state.unit === 0) return { label: `Enter the first ${unitWord.toLowerCase()}`, act: run.enterUnit };
    if (!active) return { label: `Enter the next ${unitWord.toLowerCase()}`, act: run.enterUnit };
    const { phase, step, index } = active;
    const key = `${phase.id}#${index}`;
    const ticked = new Set(state.checks.filter((k) => k.startsWith(`${key}|`)).map((k) => k.slice(key.length + 1)));
    switch (step.kind) {
      case "rollTable": {
        const table = pack.tables[step.table];
        return {
          label: table?.title ?? "Roll",
          act: () => run.begin({ kind: "table", tableId: step.table, keyPrefix: `u${state.unit}:${key}`, label: table?.title ?? step.table, completes: { phase, index } }),
        };
      }
      case "actions":
        return { label: "Continue", act: () => run.begin({ kind: "actions", actions: step.do, keyPrefix: `u${state.unit}:${key}`, label: phase.label, completes: { phase, index } }) };
      case "manual": {
        const list = step.checklist ?? [];
        const done = checklistDone(list, pack, state, ticked);
        return { label: "Done", act: () => run.completeStep(phase, index), disabled: !done, ...(done ? {} : { note: "Tick the list on the page first." }) };
      }
      case "finalizeUnit": {
        const done = checklistDone(step.confirm ?? [], pack, state, ticked) && run.blockingObligations.length === 0;
        return { label: v.finalize, act: () => run.finalizeUnit(phase, index), disabled: !done, ...(done ? {} : { note: "Something on the page still needs ticking or settling." }) };
      }
      case "declareSubject":
        return { note: `Declare the ${v.subject.one.toLowerCase()} on the page.` };
    }
  };
  const next = move();

  return (
    <div className="pipPanel">
      <header className="pipHead">
        <strong>{pack.title}</strong>
        <span className="muted small">
          {unitWord} {state.unit || "—"}
          {state.name ? ` · ${state.name}` : ""}
        </span>
      </header>

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
        </section>
      )}

      {!receipt && active && (
        <p className="pipWhere muted small">
          {active.phase.label}
          {"label" in active.step && active.step.label ? ` · ${active.step.label}` : ""}
        </p>
      )}

      <div className="pipMove">
        {"label" in next ? (
          <button className="primary big" disabled={next.disabled || run.readOnly} onClick={next.act}>
            {next.label}
          </button>
        ) : null}
        {next.note && <p className="muted small">{next.note}</p>}
      </div>

      <div className="pipTools">
        <button className="ghost tiny" onClick={run.undo} disabled={!run.canUndo || run.readOnly}>
          Undo
        </button>
        {!run.seededRun && (
          <label className="toggle small">
            <input type="checkbox" checked={run.autoRoll} onChange={(e) => run.setAutoRoll(e.target.checked)} />
            <span>Auto-roll</span>
          </label>
        )}
      </div>

      {latest.length > 0 && (
        <ol className="pipLog">
          {latest.map((o, i) => {
            const { where, text } = entryText(o.table, o.entryId);
            return (
              <li key={`${o.at}-${i}`} className={o.targetSubject !== null ? "heat" : ""}>
                <span className="where">
                  {unitWord} {o.unit}, {where}
                </span>
                <span>{text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
