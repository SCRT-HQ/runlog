import { useState } from "react";
import { canDraw3d, dice3dEnabled, preloadDice3d, setDice3d } from "./settings.ts";

/** Dice in three dimensions, or the flat tray. On this device, like the sounds. */
export function Dice3dSwitch() {
  const [on, setOn] = useState(() => dice3dEnabled());
  if (!canDraw3d()) return null;
  return (
    <label className="toggle dice3dSwitch" title="Dice thrown into a tray, in three dimensions; off, the flat tray. The value is the same either way.">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setDice3d(e.target.checked);
          setOn(e.target.checked);
          if (e.target.checked) preloadDice3d();
        }}
      />
      <span>Dice in three dimensions</span>
    </label>
  );
}
