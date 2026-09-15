import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { apiBase, store } from "../plugin.ts";
import { attachedRun, openFace, type DeckState, type Face, type OpenTarget } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type OpenSettings = { target?: OpenTarget };

/**
 * Opens a page in the streamer's browser: the run, the guide, or the
 * pack's rules.
 *
 * The only key that does not press anything. Every address is built off
 * the plugin's own base, so a deck pointed at a copy of Runlog opens that
 * copy's pages rather than the hosted one.
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
    if (target === "run") {
      const run = attachedRun(store.state);
      return run ? `${base}/run/${encodeURIComponent(run)}` : null;
    }
    if (target === "rules") {
      // The docs drawer's own address, which opens the pack's summary.
      const packId = store.state.snapshot?.run?.packId;
      return packId ? `${base}/packs/${encodeURIComponent(packId)}/docs` : null;
    }
    return null;
  }
}
