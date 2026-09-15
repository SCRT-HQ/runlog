import { action, type DialDownEvent, type KeyDownEvent, type KeyUpEvent, type TouchTapEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { clockFace, clockPress, type DeckState, type Face } from "../state.ts";
import { HOLD_MS, HoldTimer, RunlogAction, type JsonObject, type Placed } from "./base.ts";

/**
 * The run's clock, counting on the key, and the pause or the resume under it.
 *
 * A tap turns it over; a hold stops it for good, which is the one thing
 * here there is no undoing from a key. On a dial the time takes the bar as
 * well, so a + shows how much of it is gone without anybody reading the
 * number.
 */
@action({ UUID: "com.scrthq.runlog.clock" })
export class Clock extends RunlogAction {
  private holds = new HoldTimer();

  face(state: DeckState, _settings: JsonObject, now: number): Face {
    return clockFace(state, now);
  }

  private async take(placed: Placed<JsonObject>, long: boolean): Promise<void> {
    const p = clockPress(store.state, long);
    if (!p) {
      await placed.showAlert();
      return;
    }
    await this.send(placed, p);
  }

  /** The way down is only the start of the clock: this key acts on the way back up. */
  override onKeyDown(ev: KeyDownEvent): void {
    this.holds.down(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.take(ev.action, (this.holds.up(ev.action.id) ?? 0) >= HOLD_MS);
  }

  /** A dial turns the clock over and nothing more: there is no hold to stop it with. */
  override async onDialDown(ev: DialDownEvent): Promise<void> {
    await this.take(ev.action, false);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.take(ev.action, false);
  }
}
