import { useEffect, useMemo, useState } from "react";
import { parseDice, rollDice, type Pack, type Table } from "@runlog/rules-schema";
import { subjectLabel, type InputRequest, type RunState } from "@runlog/engine";
import { Die } from "../dice/Die.tsx";
import { DiceTray } from "../dice/DiceTray.tsx";
import { toDisplayDice, type RolledDie } from "../rolling.ts";
import { lineFor, tableLines } from "./tableLook.ts";
import { NumberPad } from "./NumberPad.tsx";
import { TableLookList } from "./TableLookList.tsx";

/**
 * Answering whatever the engine is waiting on.
 *
 * The default path is a number pad for dice the player has just thrown on the
 * desk. That ordering is deliberate: a roll you made yourself and typed in
 * carries a weight that a number the machine produced for you does not, and
 * the whole point of these games is that the result feels like it happened to
 * you.
 */

export function RequestPanel({
  request,
  pack,
  state,
  onAnswer,
  onCancel,
}: {
  request: InputRequest;
  pack: Pack;
  state: RunState;
  onAnswer: (
    key: string,
    value: string | number | boolean,
    machineRolled?: boolean,
    dice?: RolledDie[],
    seed?: number,
  ) => void;
  onCancel: () => void;
}) {
  return (
    <section className="panel request">
      <h3 className="sectionTitle">The game is waiting on you</h3>
      {request.kind === "roll" && <RollRequest request={request} table={pack.tables[request.purpose] ?? null} onAnswer={onAnswer} />}
      {request.kind === "ask" && (
        <YesNo
          label={request.question}
          hint="Only you can see the work. Answer honestly; nothing checks this."
          onAnswer={(v) => onAnswer(request.key, v)}
        />
      )}
      {request.kind === "prompt" && (
        <PromptRequest request={request} pack={pack} state={state} onAnswer={onAnswer} />
      )}
      {request.kind === "chooseTarget" && (
        <ChooseTarget request={request} pack={pack} state={state} onAnswer={onAnswer} />
      )}
      <button className="ghost small" onClick={onCancel}>
        Cancel this step
      </button>
    </section>
  );
}

/** The number pad. Physical dice first, an in-app roll one tap away, and the table it is for one tap away too. */
function RollRequest({
  request,
  table,
  onAnswer,
}: {
  request: Extract<InputRequest, { kind: "roll" }>;
  /** The table this roll is for, when it is a table's own roll rather than an action's. */
  table: Table | null;
  onAnswer: (key: string, value: number, machineRolled?: boolean, dice?: RolledDie[], seed?: number) => void;
}) {
  const [typed, setTyped] = useState("");
  // The table, opened beside the pad. A line pressed puts its number on
  // the pad; Enter is still the player's, so a forced number is chosen
  // twice and typed once, and the log says typed.
  const [tableOpen, setTableOpen] = useState(false);
  /**
   * A roll in flight: decided already, but not yet answered.
   *
   * The value is chosen the moment the button is pressed and the dice then
   * settle onto it. Nothing is reported to the engine until they stop: a
   * result that appears while they are still in the air answers the question
   * before the throw has finished asking it.
   */
  const [thrown, setThrown] = useState<{ total: number; dice: RolledDie[]; seed: number } | null>(null);
  // The dice have stopped. The number is decided the moment the button is
  // pressed, but it is not shown until they land: a total beside dice
  // still tumbling takes the roll's one moment of suspense away.
  const [settled, setSettled] = useState(false);
  const [rollId, setRollId] = useState(0);

  const dice = useMemo(() => {
    try {
      return parseDice(request.dice);
    } catch {
      return null;
    }
  }, [request.dice]);

  // Reset between questions, so an answer cannot be carried into the next one.
  useEffect(() => {
    setTyped("");
    setThrown(null);
    setSettled(false);
  }, [request.key]);

  // Once the dice have landed, the number shows and is read for a beat
  // before the answer goes in and the receipt takes the panel's place.
  useEffect(() => {
    if (!settled || !thrown) return;
    const timer = window.setTimeout(() => onAnswer(request.key, thrown.total, true, thrown.dice, thrown.seed), 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const value = Number(typed);
  const inRange = dice ? value >= dice.min && value <= dice.max : typed.length > 0;
  const ok = typed.length > 0 && inRange;
  const lines = useMemo(() => (table ? tableLines(table, dice) : []), [table, dice]);
  const landing = table && ok ? lineFor(lines, table, value) : null;

  const submit = () => ok && onAnswer(request.key, value);

  return (
    <div className="rollRequest">
      <p className="askLabel">
        {request.label ?? `Roll ${request.dice}`}
        <span className="muted">: {request.dice}</span>
      </p>

      <div className={`padRow${thrown ? " rolling" : ""}`}>
        <input
          className="rollInput"
          inputMode="numeric"
          autoFocus
          value={typed}
          placeholder={dice ? `${dice.min}-${dice.max}` : "result"}
          onChange={(e) => setTyped(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-label={`Result of ${request.dice}`}
        />
        <button className="primary" disabled={!ok || !!thrown} onClick={submit}>
          Enter
        </button>
        <button
          className="ghost"
          disabled={!!thrown}
          onClick={() => {
            // A convenience, not the default -- and flagged as machine-rolled,
            // so the log never claims you threw a die you did not throw.
            if (!dice) return;
            const { total, dice: values } = rollDice(request.dice, Math.random);
            // The value is decided here; the seed is only how the dice fly.
            setSettled(false);
            setThrown({ total, dice: toDisplayDice(request.dice, values, total), seed: Math.floor(Math.random() * 4294967296) });
            setRollId((n) => n + 1);
          }}
        >
          {thrown ? "Rolling…" : "Roll for me"}
        </button>
        {lines.length > 0 && (
          <button className={`ghost ${tableOpen ? "on" : ""}`} aria-expanded={tableOpen} onClick={() => setTableOpen((o) => !o)} title="See the lines this roll can land on">
            Table
          </button>
        )}
      </div>

      {tableOpen && table && (
        <TableLookList table={table} lines={lines} landing={landing} disabled={!!thrown} onPick={(v) => setTyped(String(v))} />
      )}

      {thrown && (
        <div className="throw">
          <DiceTray
            dice={thrown.dice}
            rollId={rollId}
            seed={thrown.seed}
            onSettled={() => setSettled(true)}
          />
          <div className={`rollTotal ${settled ? "" : "pending"}`} aria-live="polite">
            <span className="big">{settled ? thrown.total : "…"}</span>
            <span className="how">{request.dice}</span>
          </div>
        </div>
      )}

      {typed.length > 0 && !inRange && dice && (
        <p className="warnText">
          {request.dice} can only produce {dice.min}-{dice.max}.
        </p>
      )}

      {/* Once the dice are in the air the question has been answered; a pad
          under them invites an answer that will not be taken, and on a phone
          it is the tallest thing on the screen at the moment the dice are
          the only thing worth looking at. */}
      {!thrown && <NumberPad onDigit={(n) => setTyped((t) => `${t}${n}`)} onBackspace={() => setTyped((t) => t.slice(0, -1))} />}
    </div>
  );
}

function YesNo({
  label,
  hint,
  onAnswer,
}: {
  label: string;
  hint?: string;
  onAnswer: (v: boolean) => void;
}) {
  return (
    <div>
      <p className="askLabel">{label}</p>
      {hint && <p className="muted small">{hint}</p>}
      <div className="padRow">
        <button className="primary" onClick={() => onAnswer(true)}>
          Yes
        </button>
        <button className="ghost" onClick={() => onAnswer(false)}>
          No
        </button>
      </div>
    </div>
  );
}

function PromptRequest({
  request,
  pack,
  state,
  onAnswer,
}: {
  request: Extract<InputRequest, { kind: "prompt" }>;
  pack: Pack;
  state: RunState;
  onAnswer: (key: string, value: string | number | boolean) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => setText(""), [request.key]);

  if (request.promptKind === "confirm") {
    return <YesNo label={request.label} onAnswer={(v) => onAnswer(request.key, v)} />;
  }

  if (request.promptKind === "chooseSubject") {
    const candidates = state.subjects.filter(
      (s) => !s.removed && (!request.eligibleOnly || s.finalized),
    );
    return (
      <div>
        <p className="askLabel">{request.label}</p>
        <div className="options">
          {candidates.map((s) => (
            <button key={s.id} className="choice" onClick={() => onAnswer(request.key, s.id)}>
              <strong>#{s.id}</strong> {subjectLabel(pack, s)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (request.promptKind === "chooseValue" || request.promptKind === "chooseState") {
    const options =
      request.options ??
      Object.entries(pack.states ?? {}).map(([id, s]) => `${id}|${s.label}`);
    return (
      <div>
        <p className="askLabel">{request.label}</p>
        <div className="options">
          {options.map((o) => {
            const [value, label] = o.includes("|") ? o.split("|") : [o, o];
            return (
              <button
                key={value}
                className="choice"
                onClick={() => onAnswer(request.key, value!)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="askLabel">{request.label}</p>
      <div className="padRow">
        <input
          className="textInput"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && text && onAnswer(request.key, text)}
        />
        <button className="primary" disabled={!text} onClick={() => onAnswer(request.key, text)}>
          Enter
        </button>
      </div>
    </div>
  );
}

function ChooseTarget({
  request,
  pack,
  state,
  onAnswer,
}: {
  request: Extract<InputRequest, { kind: "chooseTarget" }>;
  pack: Pack;
  state: RunState;
  onAnswer: (key: string, value: number) => void;
}) {
  return (
    <div>
      <p className="askLabel">{request.label}</p>
      <p className="muted small">
        The rules hand you this one. Choose from the {request.eligible.length} still eligible.
      </p>
      <div className="options">
        {request.eligible.map((id) => {
          const subject = state.subjects.find((s) => s.id === id);
          return (
            <button key={id} className="choice" onClick={() => onAnswer(request.key, id)}>
              <strong>#{id}</strong> {subject ? subjectLabel(pack, subject) : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A small die used as a decoration next to a pending roll. */
export function RollHint({ dice }: { dice: string }) {
  try {
    const { faces } = parseDice(dice);
    return <Die faces={faces} display="?" />;
  } catch {
    return null;
  }
}
