import { ALERT_KINDS, type AlertChoice, type AlertSettings } from "./settings.ts";
import { play, SOUNDS } from "./sounds.ts";

/**
 * Which moments make a sound, and which. A row per kind with a sound to
 * pick, a play button to hear it, and one volume for all of them.
 */
export function AlertsPanel({ settings, onChange }: { settings: AlertSettings; onChange: (next: AlertSettings) => void }) {
  const set = (id: keyof AlertSettings["kinds"], choice: AlertChoice) => onChange({ ...settings, kinds: { ...settings.kinds, [id]: choice } });
  return (
    <div className="alerts">
      <label className="alertVolume">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          onChange={(e) => onChange({ ...settings, volume: Number(e.target.value) })}
          aria-label="Alert volume"
        />
      </label>
      <ul className="alertList">
        {ALERT_KINDS.map((k) => {
          const choice = settings.kinds[k.id];
          return (
            <li key={k.id} className={choice === "off" ? "off" : ""}>
              <div className="alertWhat">
                <strong>{k.label}</strong>
                <span className="muted small">{k.what}</span>
              </div>
              <div className="alertPick">
                <select value={choice} aria-label={`Sound for: ${k.label}`} onChange={(e) => set(k.id, e.target.value as AlertChoice)}>
                  <option value="off">Off</option>
                  {SOUNDS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button className="ghost tiny" disabled={choice === "off"} title="Hear it" onClick={() => choice !== "off" && play(choice, settings.volume)}>
                  ▶
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Kept on this device. A phone buzzes too, where it can.</p>
    </div>
  );
}
