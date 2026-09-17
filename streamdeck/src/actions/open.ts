import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { apiBase, store } from "../plugin.ts";
import { attachedRun, openFace, type DeckState, type Face, type OpenTarget } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type OpenSettings = { target?: OpenTarget };

/**
 * Opens a page in the streamer's browser: the run, its dock, a new run,
 * the guide, or the pack's rules.
 *
 * The only key that does not press anything. Every address is built off
 * the plugin's own base, so a deck pointed at a copy of Runlog opens that
 * copy's pages rather than the hosted one.
 *
 * Handing over a profile was on this key once. It is Install a profile
 * now, which takes any pack in the library rather than the one the deck
 * happens to be following.
 */
@action({ UUID: "com.scrthq.runlog.open" })
export class Open extends RunlogAction<OpenSettings> {
  face(state: DeckState, settings: OpenSettings): Face {
    return openFace(state, settings.target);
  }

  override async onKeyDown(ev: KeyDownEvent<OpenSettings>): Promise<void> {
    const url = this.url(ev.payload.settings.target);
    if (!url) {
      await ev.action.showAlert();
      return;
    }
    streamDeck.system.openUrl(url);
    await ev.action.showOk();
  }

  /** The page this key was set to, or nothing where the deck is not holding what it needs. */
  private url(target?: OpenTarget): string | null {
    const base = apiBase();
    // The guide is readable whatever the deck is holding, so it is answered
    // before anything is asked of the run.
    if (target === "guide") return `${base}/guide/stream-deck`;
    // Starting a run asks nothing of the one the deck is on, the way the
    // guide does not.
    if (target === "newrun") return `${base}/create`;
    if (target === "run") {
      const run = attachedRun(store.state);
      return run ? `${base}/run/${encodeURIComponent(run)}` : null;
    }
    if (target === "dock") {
      // The dock's own address, from `apps/web/src/dock/route.ts`: the run's
      // remote on a page of its own, for a streaming app to keep beside the
      // preview.
      const run = attachedRun(store.state);
      return run ? `${base}/dock/controls/${encodeURIComponent(run)}` : null;
    }
    if (target === "rules") {
      // The docs drawer's own address, which opens the pack's summary.
      const packId = store.state.snapshot?.run?.packId;
      return packId ? `${base}/packs/${encodeURIComponent(packId)}/docs` : null;
    }
    return null;
  }
}
