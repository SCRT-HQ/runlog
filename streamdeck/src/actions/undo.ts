import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { undoFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

/** Takes back the last result. */
@action({ UUID: "com.scrthq.runlog.undo" })
export class Undo extends RunlogAction {
  face(state: DeckState): Face {
    return undoFace(state);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.send(ev.action, { press: "undo" });
  }
}
