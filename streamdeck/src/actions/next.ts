import { action, type KeyDownEvent, type TouchTapEvent } from "@elgato/streamdeck";

import { nextFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

/** Whatever the run is waiting on, pressed. */
@action({ UUID: "com.scrthq.runlog.next" })
export class Next extends RunlogAction {
  face(state: DeckState): Face {
    return nextFace(state);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.send(ev.action, { press: "primary" });
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.send(ev.action, { press: "primary" });
  }
}
