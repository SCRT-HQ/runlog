import { useEffect, useRef, useState } from "react";
import { AlertsPanel } from "../alerts/AlertsPanel.tsx";
import type { AlertSettings } from "../alerts/settings.ts";
import { Dice3dSwitch } from "../dice/Dice3dSwitch.tsx";
import { ThemeMenu } from "../theme/ThemeMenu.tsx";
import { carriesOnByItself, rollsForMeByDefault, setCarriesOnByItself, setRollsForMeByDefault } from "./pace.ts";
import { StreamSettings } from "./StreamPanel.tsx";
import { ChatSettings } from "./ChatPanel.tsx";
import type { Pack } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";

/**
 * What is about this device rather than about the run: the theme, the
 * sounds, the dice, who rolls, and the pop-outs for a stream. It used to be
 * spread over three places (the theme in the account menu, auto-roll in the
 * run's toolbar, the rest here); it is one sheet now, with the streaming
 * setup on a tab of its own so the first tab stays short for the many who
 * never stream. Reachable from the account menu outside a run as well,
 * since nothing on the first tab needs one.
 */
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
}: {
  runId: string | null;
  race: boolean;
  /** The open run's pack and record, for the Chat section: what moves may be asked for, and whether asks are on. Absent outside a run. */
  pack?: Pack;
  record?: StoredRun | null;
  alerts: AlertSettings;
  onAlerts: (next: AlertSettings) => void;
  /** Who throws the dice in the open run, and whether the run leaves any choice. Absent outside a run. */
  rolling?: { auto: boolean; seeded: boolean; onAuto: (on: boolean) => void };
  /** Float the run's controls in a window of their own. */
  onControls?: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<"device" | "streaming">("device");
  const [carryOn, setCarryOn] = useState(carriesOnByItself);
  const [rollForMe, setRollForMe] = useState(rollsForMeByDefault);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const streaming = runId !== null;
  const rollSwitch = rolling ? rolling.auto : rollForMe;
  const setRoll = (on: boolean) => {
    // The device remembers the choice for the next run; the open run takes it now.
    setRollsForMeByDefault(on);
    setRollForMe(on);
    rolling?.onAuto(on);
  };

  return (
    <div className="veil" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="panel settingsDialog" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div className="dialogBar">
          <div className="dialogHead">
            <h2 id="settingsTitle">Settings</h2>
            {streaming && (
              <div className="dialogTabs" role="tablist" aria-label="Settings">
                <button role="tab" aria-selected={tab === "device"} className={`chip pick ${tab === "device" ? "on" : ""}`} onClick={() => setTab("device")}>
                  This device
                </button>
                <button role="tab" aria-selected={tab === "streaming"} className={`chip pick ${tab === "streaming" ? "on" : ""}`} onClick={() => setTab("streaming")}>
                  Streaming
                </button>
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

        {tab === "device" && (
          <>
            <section>
              <h3 className="sectionTitle">
                Look <span className="muted">the lights</span>
              </h3>
              <ThemeMenu />
            </section>

            <section>
              <h3 className="sectionTitle">
                Alerts <span className="muted">and sounds</span>
              </h3>
              <AlertsPanel settings={alerts} onChange={onAlerts} />
            </section>

            <section>
              <h3 className="sectionTitle">
                Rolls <span className="muted">whose dice, and how fast</span>
              </h3>
              <Dice3dSwitch />
              {rolling?.seeded ? (
                <p className="muted small">This run rolls from its seed, so everyone at it meets the same dice.</p>
              ) : (
                <label className="toggle" title="Off by default: the dice are yours">
                  <input type="checkbox" checked={rollSwitch} onChange={(e) => setRoll(e.target.checked)} />
                  <span>Roll for me, without asking</span>
                </label>
              )}
              <label className="toggle" title="A receipt shows what a roll did; by default it waits for Carry on">
                <input
                  type="checkbox"
                  checked={carryOn}
                  onChange={(e) => {
                    setCarriesOnByItself(e.target.checked);
                    setCarryOn(e.target.checked);
                  }}
                />
                <span>After a roll, carry on by itself</span>
              </label>
              <p className="muted small">Kept on this device.</p>
            </section>
          </>
        )}

        {tab === "streaming" && streaming && (
          <section>
            <h3 className="sectionTitle">
              Stream <span className="muted">pop-out widgets</span>
            </h3>
            <StreamSettings runId={runId} race={race} onControls={onControls} />
            {pack && record && <ChatSettings pack={pack} record={record} />}
          </section>
        )}
      </section>
    </div>
  );
}
