import { useRef, useState, type KeyboardEvent } from "react";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { useConfirm } from "../ui/useConfirm.tsx";
import type { AlertSettings } from "../alerts/settings.ts";
import { DeviceSettings } from "../settings/DeviceSettings.tsx";
import { StreamSettings } from "./StreamPanel.tsx";
import { ChatSettings } from "./ChatPanel.tsx";
import { ControlSettings } from "./ControlSettings.tsx";
import type { Pack } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import type { ChosenSetup } from "../control/setups.ts";

/**
 * What is about this device rather than about the run: the theme, the
 * sounds, the dice, who rolls, and the pop-outs for a stream. It used to be
 * spread over three places (the theme in the account menu, auto-roll in the
 * run's toolbar, the rest here); it is one sheet now, with the streaming
 * setup on a tab of its own so the first tab stays short for the many who
 * never stream. Reachable from the account menu outside a run as well,
 * since nothing on the first tab needs one.
 */
type Tab = "device" | "run" | "widgets" | "chat" | "control";

export function SettingsDialog({
  runId,
  race,
  alerts,
  onAlerts,
  rolling,
  session,
  onControls,
  onClose,
  pack,
  record,
  seats,
  onAsks,
  onControl,
  onSetup,
  onHandOut,
  reachable,
}: {
  runId: string | null;
  race: boolean;
  /** The open run's pack and record, for the Chat section: what moves may be asked for, and whether asks are on. Absent outside a run. */
  pack?: Pack;
  record?: StoredRun | null;
  /** Remember what the server said about taking asks, so the tray and this panel agree at once. */
  onAsks?: (asks: StoredRun["asks"]) => void | Promise<void>;
  /** What a tool attached to the game should do about this run. */
  onControl?: (control: unknown) => void | Promise<void>;
  /** Change which setup the open run is played under, and hand it out. */
  onSetup?: (setup: unknown) => void | Promise<void>;
  onHandOut?: (chosen: ChosenSetup) => boolean;
  /** What the run found out about being reachable, for the Control section's address. */
  reachable?: { link: string | null; key: string | null; working: boolean } | undefined;
  /** The roster of a moderated run, so the Control section can address one racer. */
  seats?: string[];
  alerts: AlertSettings;
  onAlerts: (next: AlertSettings) => void;
  /** Who throws the dice in the open run, and whether the run leaves any choice. Absent outside a run. */
  rolling?: { auto: boolean; seeded: boolean; onAuto: (on: boolean) => void };
  /**
   * The open run itself: what it is called, the pack's word for one, and
   * how to throw it away. Absent outside a run, and the run's own tab with
   * it.
   */
  session?: { name: string | null; noun: string; onDiscard: () => void };
  /** Float the run's controls in a window of their own. */
  onControls?: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<Tab>("device");
  // Discarding deletes the log, so it is asked first; see useConfirm.
  const { dialog, ask } = useConfirm();
  // Close takes focus on open, as it always has, and now the rest of the
  // page cannot be tabbed to while the sheet is up.
  useFocusTrap(panel, true, onClose, close);

  /**
   * The tabs there are, which is a question about what this dialog was
   * opened over. Outside a run there is only the device; inside one the
   * widgets follow the run, and chat and control need the pack to say
   * what may be asked for and what a result means.
   *
   * They were one Streaming tab until three panels had grown under it and
   * finding the rule you wanted meant scrolling past two setups you were
   * not there for.
   */
  const tabs: { id: Tab; label: string }[] = [
    { id: "device", label: "This device" },
    ...(session ? [{ id: "run" as const, label: "This run" }] : []),
    ...(runId !== null ? [{ id: "widgets" as const, label: "Widgets" }] : []),
    ...(pack && record
      ? [
          { id: "chat" as const, label: "Chat" },
          { id: "control" as const, label: "Control" },
        ]
      : []),
  ];
  // A tab that is no longer there, because the run closed under it, must
  // not leave the sheet blank.
  const at = tabs.some((t) => t.id === tab) ? tab : "device";

  /**
   * The tabs answer the arrow keys, and only the chosen one is in the Tab
   * order, which is what a tab list is for: Tab is the way out of the
   * strip rather than a walk through every tab in it.
   */
  const strip = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const to =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    const next = to < 0 ? undefined : tabs[to];
    if (!next) return;
    e.preventDefault();
    setTab(next.id);
    strip.current[next.id]?.focus();
  };

  return (
    <div className="veil" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel settingsDialog" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabIndex={-1} ref={panel}>
        {dialog}
        <div className="dialogBar">
          <div className="dialogHead">
            <h2 id="settingsTitle">Settings</h2>
            {tabs.length > 1 && (
              <div className="dialogTabs" role="tablist" aria-label="Settings">
                {tabs.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`settingsTab-${t.id}`}
                    aria-controls={`settingsPanel-${t.id}`}
                    aria-selected={at === t.id}
                    tabIndex={at === t.id ? 0 : -1}
                    ref={(el) => {
                      strip.current[t.id] = el;
                    }}
                    className={`chip pick ${at === t.id ? "on" : ""}`}
                    onClick={() => setTab(t.id)}
                    onKeyDown={(e) => onTabKey(e, i)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="dialogClose">
            <span className="muted small mono">Esc</span>
            <button ref={close} className="ghost tiny" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div
          className="dialogPanel"
          {...(tabs.length > 1
            ? { role: "tabpanel", id: `settingsPanel-${at}`, "aria-labelledby": `settingsTab-${at}`, tabIndex: -1 }
            : {})}
        >
          {at === "device" && <DeviceSettings alerts={alerts} onAlerts={onAlerts} {...(rolling ? { rolling } : {})} />}

          {at === "run" && session && (
            <section>
              {/*
                The one destructive thing a run can be told to do, kept off
                the toolbar it used to sit between Settings and Undo on, and
                put last, where a page puts what it does not want pressed by
                accident. The question it asks and the call it makes on a yes
                are the ones the toolbar's button made.
              */}
              <div className="dangerRow">
                <p className="muted small">Its log is deleted, and there is no undoing it.</p>
                <button
                  className="ghost danger"
                  title={`End this ${session.noun} and delete its log`}
                  onClick={() => {
                    const named = session.name ? `${session.name}` : `this ${session.noun}`;
                    void ask({
                      ask: `Discard ${named}?`,
                      detail: "Its log is deleted, and there is no undoing it.",
                      confirm: "Discard",
                      destructive: true,
                    }).then((yes) => yes && session.onDiscard());
                  }}
                >
                  Discard
                </button>
              </div>
            </section>
          )}

          {at === "widgets" && runId !== null && (
            <section>
              <h3 className="sectionTitle">
                Widgets <span className="muted">what a stream shows</span>
              </h3>
              <StreamSettings runId={runId} race={race} onControls={onControls} />
            </section>
          )}

          {at === "chat" && pack && record && (
            <section>
              <ChatSettings pack={pack} record={record} onAsks={onAsks} />
            </section>
          )}

          {at === "control" && pack && record && (
            <section>
              <ControlSettings
                pack={pack}
                record={record}
                onControl={onControl}
                {...(reachable ? { reachable } : {})}
                {...(onSetup ? { onSetup } : {})}
                {...(onHandOut ? { onHandOut } : {})}
                {...(seats && seats.length > 0 ? { seats } : {})}
              />
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
