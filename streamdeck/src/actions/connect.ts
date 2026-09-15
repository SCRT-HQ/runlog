import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { store, turnOff, turnOn } from "../plugin.ts";
import { connectFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

/**
 * The switch the whole plugin hangs off.
 *
 * A Stream Deck is never off, so a socket held whenever the plugin was
 * configured would be a socket held around the clock for nothing. This is
 * the state the streamer enters instead: nothing is open until it is
 * pressed, and pressing it again closes everything.
 */
@action({ UUID: "com.scrthq.runlog.connect" })
export class Connect extends RunlogAction {
  face(state: DeckState): Face {
    return connectFace(state);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (store.state.session === "none") {
      // Nothing to connect to yet; the face already says to sign in.
      await ev.action.showAlert();
      return;
    }
    if (store.state.on) turnOff();
    else turnOn();
  }
}
