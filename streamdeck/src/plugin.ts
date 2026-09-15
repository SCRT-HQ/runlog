import streamDeck from "@elgato/streamdeck";

import { Connect } from "./actions/connect.ts";
import { Metric } from "./actions/metric.ts";
import { Next } from "./actions/next.ts";
import { Press } from "./actions/press.ts";
import { Run } from "./actions/run.ts";
import { Undo } from "./actions/undo.ts";
import { loadSession, normalizeBase, signIn, signOut, type Account } from "./session.ts";
import { openWire } from "./socket.ts";
import { makeStore } from "./store.ts";
import { idleDeadline } from "./state.ts";

/** Where Runlog lives when the streamer has not said otherwise. */
const DEFAULT_API = "https://runlog.scrthq.com";

/**
 * What the plugin keeps between launches.
 *
 * The address and the pinned run, and nothing else: global settings are
 * handed to the property inspector, which is a web view, so the session
 * never comes near them. It lives in a file of the plugin's own.
 */
type Globals = { apiBase?: string; pinned?: string | null };

let apiBase = DEFAULT_API;

export const store = makeStore();
export const wire = openWire((): Account => ({ apiBase }), store);

/**
 * Switching the deck on.
 *
 * The address is read again first, so the one the streamer last typed is the
 * one dialed. Reconnecting through drops after that is the wire's own job.
 */
export function turnOn(): void {
  if (store.state.on) return;
  store.dispatch({ t: "on", on: true });
  void (async () => {
    await readGlobals();
    streamDeck.logger.info("on: connecting");
    wire.connect();
  })();
}

/** Switching it off, by a press or - with `idle` - by the deck's own timer. */
export function turnOff(idle = false): void {
  wire.disconnect();
  store.dispatch({ t: "on", on: false, idle });
  streamDeck.logger.info(idle ? "off: idle for thirty minutes" : "off: by request");
}

/** Tells whichever inspector is open where it is pointed and whether anyone is signed in. */
export async function sayWho(): Promise<void> {
  await streamDeck.ui.sendToPropertyInspector({ t: "who", signedIn: loadSession() !== null, apiBase });
}

function applyGlobals(g: Globals): void {
  apiBase = normalizeBase(g.apiBase ?? "") || DEFAULT_API;
  if (g.pinned !== undefined) store.dispatch({ t: "pin", id: g.pinned });
}

async function readGlobals(): Promise<void> {
  applyGlobals(await streamDeck.settings.getGlobalSettings<Globals>());
}

// A deck holding no run for half an hour closes its own socket rather than
// sitting on one all night. A deck following a run never times out.
let idleSince: number | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
store.subscribe((state) => {
  const now = Date.now();
  const deadline = idleDeadline(state, idleSince ?? now);
  if (deadline === null) {
    idleSince = null;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    return;
  }
  if (idleTimer) return;
  idleSince = now;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    turnOff(true);
  }, deadline - now);
});

/** The device flow's two lines, as the inspector needs them: the page and the code. */
function codeFromLines(): (line: string) => void {
  let code: string | null = null;
  let url: string | null = null;
  return (line) => {
    code = /^ {2}Code {2}(\S.*)$/.exec(line)?.[1]?.trim() ?? code;
    url = /^ {2}Open {2}(\S+)$/.exec(line)?.[1] ?? url;
    if (code && url) void streamDeck.ui.sendToPropertyInspector({ t: "code", code, url });
  };
}

streamDeck.ui.onSendToPlugin<{ t?: string }>(async (ev) => {
  switch (ev.payload?.t) {
    case "signin":
      try {
        streamDeck.logger.info("sign-in: starting the device flow");
        await signIn({ apiBase }, codeFromLines(), () => {});
        store.dispatch({ t: "session", state: "ok" });
        streamDeck.logger.info("sign-in: done");
        // Signed in is not connected: the streamer presses Connect.
        await streamDeck.ui.sendToPropertyInspector({ t: "who", name: "you", signedIn: true, apiBase });
      } catch (e) {
        // The reason goes back to the inspector, not only to the log: the
        // streamer is looking at the button they pressed, and a status line
        // that flips back to "Not signed in" tells them nothing.
        const error = e instanceof Error ? e.message : "unknown";
        streamDeck.logger.error(`sign-in: failed (${error})`);
        await streamDeck.ui.sendToPropertyInspector({ t: "who", signedIn: false, apiBase, error });
      }
      break;
    case "signout":
      turnOff();
      signOut();
      store.dispatch({ t: "session", state: "none" });
      streamDeck.logger.info("signed out");
      await streamDeck.ui.sendToPropertyInspector({ t: "who", signedIn: false, apiBase });
      break;
    case "reconnect":
      turnOff();
      turnOn();
      break;
    default:
      break;
  }
});

streamDeck.logger.setLevel("info");
streamDeck.settings.onDidReceiveGlobalSettings<Globals>((ev) => applyGlobals(ev.settings));

// A flash lasts three seconds and nothing else clears it; the tick is what
// puts a refused key back to what it was saying.
setInterval(() => store.dispatch({ t: "tick" }), 1000);

for (const a of [new Next(), new Press(), new Undo(), new Run(), new Metric(), new Connect()]) {
  streamDeck.actions.registerAction(a);
}

void streamDeck.connect().then(async () => {
  // Launch is quiet: the settings, the session, and nothing else. No socket
  // and no token refresh until the streamer presses Connect.
  await readGlobals();
  const signedIn = loadSession() !== null;
  store.dispatch({ t: "session", state: signedIn ? "ok" : "none" });
  streamDeck.logger.info(`launched: ${signedIn ? "signed in" : "not signed in"}, not connected`);
});
