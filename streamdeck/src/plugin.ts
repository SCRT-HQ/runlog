import streamDeck from "@elgato/streamdeck";

import { AutoRoll } from "./actions/autoroll.ts";
import { Clock } from "./actions/clock.ts";
import { Command } from "./actions/command.ts";
import { Connect } from "./actions/connect.ts";
import { Finish } from "./actions/finish.ts";
import { Install } from "./actions/install.ts";
import { Metric } from "./actions/metric.ts";
import { Next } from "./actions/next.ts";
import { Open } from "./actions/open.ts";
import { Press } from "./actions/press.ts";
import { Roll } from "./actions/roll.ts";
import { pin, Run, runsForInspector } from "./actions/run.ts";
import { Setup } from "./actions/setup.ts";
import { Undo } from "./actions/undo.ts";
import { installedFor, installedProfiles } from "./installed.ts";
import { buildFor, install } from "./profiles-on-demand.ts";
import { PACK_PROFILES, profileFor } from "./profiles.ts";
import { allSeen, loadSeen, remember, setupsInOffer, type SeenSetup } from "./seen.ts";
import { loadSession, normalizeBase, signIn, signOut, type Account } from "./session.ts";
import { openWire } from "./socket.ts";
import { makeStore } from "./store.ts";
import { idleDeadline, type DeckState } from "./state.ts";

/** Where Runlog lives when the streamer has not said otherwise. */
const DEFAULT_API = "https://runlog.scrthq.com";

/**
 * What the plugin keeps between launches.
 *
 * The address and the pinned run, and nothing else: global settings are
 * handed to the property inspector, which is a web view, so the session
 * never comes near them. It lives in a file of the plugin's own.
 */
type Globals = {
  apiBase?: string;
  pinned?: string | null;
  switchProfiles?: boolean;
  profilesOffered?: string[];
  setupsSeen?: Record<string, SeenSetup[]>;
};

let base = DEFAULT_API;

/** Whether attaching to a run moves the deck to that run's profile. Unset is on. */
let switchProfiles = true;

/**
 * Where Runlog is, for a key that has to name an address rather than
 * press through the wire. The normalized global setting, so a deck
 * pointed at a copy of the app opens that copy pages.
 */
export function apiBase(): string {
  return base;
}

export const store = makeStore();
export const wire = openWire((): Account => ({ apiBase: base }), store);

/**
 * Attaching moves the deck to the profile laid out for the run's pack.
 *
 * It is the one attach feedback that works on every model, a six-key Mini
 * included, and it puts the pack's own moves under the streamer's hand the
 * moment a run starts. A pack's profile is not installed until this asks
 * for it, which is what keeps forty profiles out of a new install's list.
 *
 * On the first snapshot of an attach rather than on the attach itself: the
 * pack's id travels with the snapshot, and the run's is not known until one
 * lands. Once per attach after that, since a snapshot landing is not a
 * reason to yank the deck away from wherever the streamer has gone since.
 *
 * A pack the plugin ships no layout for would land on the generic profile
 * with none of its own moves on it. That snapshot has everything a layout
 * is built from, so one is built from the run and handed to the Stream Deck
 * app to import before the switch. Once per pack, for good: the app's
 * import prompt is the streamer's to answer, and asking again on every
 * launch fills their list with copies of the one profile.
 *
 * And the app's own folder is read first, for either kind of pack. A
 * streamer who already imported a profile for this pack has one the plugin
 * cannot switch to and must not hand over again: the app keeps both copies
 * and names the second one, so asking for the shipped profile would leave
 * them two lists of the same keys and take the deck off the one they
 * arranged.
 */
let switchedFor: string | null = null;

/**
 * The packs a profile has been built and handed over for.
 *
 * In the global settings rather than in memory, so a plugin restart does
 * not offer the same pack again. The Open key's "This pack's profile" and
 * the Install a profile key are the ways to ask for one again.
 */
const offered = new Set<string>();

/** Writes the pack into the offered list, keeping whatever else is in the settings. */
async function markOffered(packId: string): Promise<void> {
  if (offered.has(packId)) return;
  offered.add(packId);
  const settings = await streamDeck.settings.getGlobalSettings<Globals>();
  await streamDeck.settings.setGlobalSettings({ ...settings, profilesOffered: [...offered] });
}

store.subscribe((s) => {
  if (!s.attached) {
    switchedFor = null;
    return;
  }
  if (!switchProfiles || switchedFor === s.attached || !s.snapshot) return;
  switchedFor = s.attached;
  const packId = s.snapshot.run?.packId;
  const ships = packId !== undefined && PACK_PROFILES[packId] !== undefined;
  const build = packId !== undefined && !ships && !offered.has(packId);
  if (packId !== undefined && (ships || build)) {
    const pack = { id: packId, ...(s.snapshot.run?.packTitle ? { title: s.snapshot.run.packTitle } : {}) };
    const held = installedFor(pack, installedProfiles());
    // Either kind counts as offered: nothing should hand this pack a
    // profile again on a later attach.
    if (held !== null) void markOffered(packId);
    if (held === "imported") {
      // The streamer has a profile of their own for this pack, under the
      // pack's own name: imported off the pack's page, off the Install key,
      // off a file somebody sent them. Nothing more is handed over, because
      // the app keeps both and calls the second one "copy" rather than
      // replacing the first. And nothing is switched: a profile somebody
      // imported is not in this plugin's manifest, so it cannot be switched
      // to, and asking the app for the shipped one instead would install a
      // second copy and take the deck off the keys they arranged.
      streamDeck.logger.info(
        ships
          ? `profile: ${packId} has a profile of its own installed, leaving the deck where it is`
          : `profile: ${packId} already has one in the Stream Deck app`,
      );
      return;
    }
  }
  for (const d of streamDeck.devices) {
    const name = profileFor(packId, d.type);
    if (!name) continue;
    if (build) {
      // Marked offered only once a deck has actually been handed a file,
      // so a run attached while no deck was plugged in still gets its
      // profile when one is.
      const built = buildFor(s, d.type);
      if (built) {
        void markOffered(packId!);
        install(built.file);
        // The app asks about the profile it was just handed; asking about
        // the generic one in the same breath would be two prompts for one
        // attach, and the generic layout is the smaller of the two.
        continue;
      }
    }
    void streamDeck.profiles.switchToProfile(d.id, name).catch(() => {});
  }
});

/**
 * The setups a run published, kept for a profile built without one.
 *
 * The Install key can build a profile for any pack on the account without
 * a run open anywhere, and the pack file it reads names no setups: a setup
 * is written for a tool rather than for a pack. The plugin ships a table
 * of the ones written in this repository, which says nothing about a pack
 * from the Marketplace or one somebody wrote themselves. The run does, on
 * every snapshot, so that is where they are read.
 *
 * Written to the global settings only when the set moved, which is the
 * first snapshot of a run and then not again.
 */
let lastSnapshot: DeckState["snapshot"] = null;
store.subscribe((s) => {
  if (s.snapshot === lastSnapshot) return;
  lastSnapshot = s.snapshot;
  const packId = s.snapshot?.run?.packId;
  if (!packId || !remember(packId, setupsInOffer(s.snapshot?.offer))) return;
  void (async () => {
    const settings = await streamDeck.settings.getGlobalSettings<Globals>();
    await streamDeck.settings.setGlobalSettings({ ...settings, setupsSeen: allSeen() });
  })();
});

// The Run inspector's list is only as fresh as the last appear; a run
// starting or ending while the picker is open moves it without the
// streamer closing and reopening the page.
let lastRuns: DeckState["runs"] | null = null;
store.subscribe((s) => {
  if (s.runs === lastRuns) return;
  lastRuns = s.runs;
  if (streamDeck.ui.action) void streamDeck.ui.sendToPropertyInspector({ t: "runs", runs: runsForInspector(s.runs), pinned: s.pinned });
});

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
  await streamDeck.ui.sendToPropertyInspector({ t: "who", signedIn: loadSession() !== null, apiBase: base });
}

function applyGlobals(g: Globals): void {
  base = normalizeBase(g.apiBase ?? "") || DEFAULT_API;
  // Unset is on: a deck that has never opened Connect's settings still
  // lands on the run's profile.
  switchProfiles = g.switchProfiles !== false;
  // Added to rather than replaced: this fires from the plugin's own write
  // as well as from another surface's, and a pack marked offered a moment
  // ago must not be dropped by a settings event that crossed it.
  for (const id of g.profilesOffered ?? []) offered.add(id);
  // Added to for the same reason: a setup seen a moment ago must survive a
  // settings event that crossed the write of it.
  loadSeen(g.setupsSeen);
  // Only on a change: this fires from the plugin's own write of a pin as
  // much as from another surface's, and a pin already applied locally
  // should not force the run's snapshot to reload for nothing.
  if (g.pinned !== undefined && g.pinned !== store.state.pinned) store.dispatch({ t: "pin", id: g.pinned });
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

/**
 * The device flow's two lines, as the inspector needs them: the page and the code.
 *
 * `deviceFlow` writes for a terminal, two spaces and a label per line.
 * Exported so a test can hold this against the lines the flow actually
 * says - the inspector shows nothing at all if the two stop matching,
 * and nothing at all is a sign-in that looks like it hung.
 */
export function codeFromLines(): (line: string) => void {
  let code: string | null = null;
  let url: string | null = null;
  let sent = false;
  return (line) => {
    code = /^ {2}Code {2}(\S.*)$/.exec(line)?.[1]?.trim() ?? code;
    url = /^ {2}Open {2}(\S+)$/.exec(line)?.[1] ?? url;
    // Once. The flow keeps talking after those two lines - a blank, then
    // what a terminal should do while it waits - and every line after them
    // still has both halves in hand.
    if (code && url && !sent) {
      sent = true;
      void streamDeck.ui.sendToPropertyInspector({ t: "code", code, url });
    }
  };
}

streamDeck.ui.onSendToPlugin<{ t?: string; id?: string | null }>(async (ev) => {
  switch (ev.payload?.t) {
    case "pin":
      await pin(ev.payload?.id ?? null);
      break;
    case "signin":
      try {
        streamDeck.logger.info("sign-in: starting the device flow");
        await signIn({ apiBase: base }, codeFromLines(), () => {});
        store.dispatch({ t: "session", state: "ok" });
        streamDeck.logger.info("sign-in: done");
        // Signed in is not connected: the streamer presses Connect.
        await streamDeck.ui.sendToPropertyInspector({ t: "who", name: "you", signedIn: true, apiBase: base });
      } catch (e) {
        // The reason goes back to the inspector, not only to the log: the
        // streamer is looking at the button they pressed, and a status line
        // that flips back to "Not signed in" tells them nothing.
        const error = e instanceof Error ? e.message : "unknown";
        streamDeck.logger.error(`sign-in: failed (${error})`);
        await streamDeck.ui.sendToPropertyInspector({ t: "who", signedIn: false, apiBase: base, error });
      }
      break;
    case "signout":
      turnOff();
      signOut();
      store.dispatch({ t: "session", state: "none" });
      streamDeck.logger.info("signed out");
      await streamDeck.ui.sendToPropertyInspector({ t: "who", signedIn: false, apiBase: base });
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

for (const a of [
  new Next(),
  new Press(),
  new Roll(),
  new Undo(),
  new Run(),
  new Metric(),
  new Connect(),
  new Setup(),
  new Command(),
  new Open(),
  new Clock(),
  new AutoRoll(),
  new Finish(),
  new Install(),
]) {
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
