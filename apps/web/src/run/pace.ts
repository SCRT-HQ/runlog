/**
 * Whether a receipt waits for "Carry on" or moves along by itself.
 *
 * Off by default: the number the dice showed deserves to be read, and the
 * next question waits behind it. A person who rolls fast can have the
 * receipt hold for a moment and go on without the button. Kept on this
 * device, like the sounds.
 */
const KEY = "runlog:carryOn";

/** How long a receipt stays before moving on by itself, when it does. */
export const CARRY_ON_HOLD_MS = 1800;

export function carriesOnByItself(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setCarriesOnByItself(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    /* the switch lasts the tab */
  }
}

/**
 * Whether a new run starts with the app rolling for the player. Off by
 * default: the dice are theirs. Set from the receipt's "Keep rolling for
 * me" or from Settings, and read when a run opens.
 */
const ROLL_KEY = "runlog:rollForMe";

export function rollsForMeByDefault(): boolean {
  try {
    return localStorage.getItem(ROLL_KEY) === "on";
  } catch {
    return false;
  }
}

export function setRollsForMeByDefault(on: boolean): void {
  try {
    if (on) localStorage.setItem(ROLL_KEY, "on");
    else localStorage.removeItem(ROLL_KEY);
  } catch {
    /* the switch lasts the tab */
  }
}
