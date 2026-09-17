import { useEffect, useRef, useState } from "react";
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
type Tab = "device" | "widgets" | "chat" | "control";

export function SettingsDialog({
  runId,
  race,
  alerts,
  onAlerts,
  rolling,
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
  /** Float the run's controls in a window of their own. */
  onControls?: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>("device");
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <div className="veil" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel settingsDialog" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div className="dialogBar">
          <div className="dialogHead">
            <h2 id="settingsTitle">Settings</h2>
            {tabs.length > 1 && (
              <div className="dialogTabs" role="tablist" aria-label="Settings">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={at === t.id}
                    className={`chip pick ${at === t.id ? "on" : ""}`}
                    onClick={() => setTab(t.id)}
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

        {at === "device" && <DeviceSettings alerts={alerts} onAlerts={onAlerts} {...(rolling ? { rolling } : {})} />}

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
      </section>
    </div>
  );
}
