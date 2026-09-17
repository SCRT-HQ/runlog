import { useState } from "react";
import { AlertsPanel } from "../alerts/AlertsPanel.tsx";
import type { AlertSettings } from "../alerts/settings.ts";
import { Dice3dSwitch } from "../dice/Dice3dSwitch.tsx";
import { carriesOnByItself, rollsForMeByDefault, SEEDED_ROLL_SENTENCE, setCarriesOnByItself, setRollsForMeByDefault } from "../run/pace.ts";

/**
 * What is about this device rather than about any run.
 *
 * One pane in two places, which is the point of it being a pane. It is
 * the first tab of a run's settings, where somebody reaches for "roll for
 * me" in the middle of playing, and it is a page of the profile, where
 * somebody who is not in a run at all can still turn the sounds off.
 *
 * Everything here is kept on this device and nowhere else, so the two
 * copies are two views of the same localStorage rather than two states
 * that have to be kept in step.
 *
 * The theme is deliberately not here. It moved to the account menu, where
 * it can be changed and changed back without opening anything: it is the
 * one setting people try on a whim, and it was behind a dialog that had
 * to be shut to see what it did.
 */
export function DeviceSettings({
  alerts,
  onAlerts,
  rolling,
}: {
  alerts: AlertSettings;
  onAlerts: (next: AlertSettings) => void;
  /**
   * The open run, where there is one.
   *
   * Two things it settles. A seeded run rolls from its seed so everybody
   * at it meets the same results, and "roll for me" is not a choice
   * there. And where there is a run, the switch is that run's rather than
   * the device's default: turning it on has to take effect now, not next
   * time, which is the whole reason somebody reached for it mid-run.
   */
  rolling?: { auto: boolean; seeded: boolean; onAuto: (on: boolean) => void } | undefined;
}) {
  const [rollForMe, setRollForMe] = useState(() => rollsForMeByDefault());
  const [carryOn, setCarryOn] = useState(() => carriesOnByItself());

  const rollSwitch = rolling ? rolling.auto : rollForMe;
  const setRoll = (on: boolean) => {
    // The device remembers the choice for the next run; the open run takes it now.
    setRollsForMeByDefault(on);
    setRollForMe(on);
    rolling?.onAuto(on);
  };

  return (
    <>
      <p className="muted small">Applies on this device, in every run.</p>

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
        {/*
          A seeded run turns this from a choice into a fact: the switch
          stays visible, disabled, so it reads as overridden rather than
          missing, with the sentence beside it saying why.
        */}
        <label className="toggle" title={rolling?.seeded ? SEEDED_ROLL_SENTENCE : "Off by default: the dice are yours"}>
          <input type="checkbox" checked={rollSwitch} disabled={rolling?.seeded} onChange={(e) => setRoll(e.target.checked)} />
          <span>Roll for me, without asking</span>
        </label>
        {rolling?.seeded && <p className="muted small">{SEEDED_ROLL_SENTENCE}</p>}
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
  );
}
