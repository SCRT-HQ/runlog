/**
 * Whether dice are thrown in three dimensions.
 *
 * On by default where the browser can draw them; a person turns it off
 * under Alerts and sounds, and the flat tray takes over. Kept on this
 * device only, like the sounds. The three.js chunk loads only when this
 * is on, and only the first time dice are thrown.
 */
const KEY = "runlog:dice3d";

export function dice3dEnabled(): boolean {
  try {
    if (localStorage.getItem(KEY) === "off") return false;
  } catch {
    /* a private window: on */
  }
  return canDraw3d();
}

export function setDice3d(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch {
    /* the switch lasts the tab */
  }
}

let drawable: boolean | null = null;

/** Whether WebGL is there to draw with; asked once. */
export function canDraw3d(): boolean {
  if (drawable !== null) return drawable;
  try {
    const canvas = document.createElement("canvas");
    drawable = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    drawable = false;
  }
  return drawable;
}

type Loaded = typeof import("./three/Dice3D.tsx");
let loading: Promise<Loaded> | null = null;

/** The three-dimensional roller, fetched once and kept; null where it cannot load. */
export function loadDice3d(): Promise<Loaded | null> {
  loading ??= import("./three/Dice3D.tsx");
  return loading.catch(() => {
    loading = null;
    return null;
  });
}

/** Fetch the roller ahead of the first throw, so the throw is not the moment the page waits. */
export function preloadDice3d(): void {
  if (dice3dEnabled()) void loadDice3d();
}
