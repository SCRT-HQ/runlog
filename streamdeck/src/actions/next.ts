import { action, type DialDownEvent, type KeyDownEvent, type TouchTapEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { nextFace, nextPress, type DeckState, type Face, type NextSettings } from "../state.ts";
import { RunlogAction, type Placed } from "./base.ts";

export type { NextSettings };

/** Whatever the run is waiting on, pressed - the decisions with it, unless told to stop. */
@action({ UUID: "com.scrthq.runlog.next" })
export class Next extends RunlogAction<NextSettings> {
  face(state: DeckState, settings: NextSettings): Face {
    return nextFace(state, settings);
  }

  /**
   * One press, whichever of the three it turns out to be.
   *
   * There is no local refusal to show: a press with nothing to take goes as
   * the bare primary, and the page refuses it in its own words, which is
   * what the face is already saying.
   */
  private async take(placed: Placed<NextSettings>, settings: NextSettings): Promise<void> {
    await this.send(placed, nextPress(store.state, settings) ?? { press: "primary" });
  }

  override async onKeyDown(ev: KeyDownEvent<NextSettings>): Promise<void> {
    await this.take(ev.action, ev.payload.settings);
  }

  override async onTouchTap(ev: TouchTapEvent<NextSettings>): Promise<void> {
    await this.take(ev.action, ev.payload.settings);
  }

  override async onDialDown(ev: DialDownEvent<NextSettings>): Promise<void> {
    await this.take(ev.action, ev.payload.settings);
  }
}
