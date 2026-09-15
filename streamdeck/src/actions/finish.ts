import { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { finishFace, finishPress, type DeckState, type Face } from "../state.ts";
import { FINISH_HOLD_MS, HoldTimer, RunlogAction } from "./base.ts";

/**
 * Ends the run, held.
 *
 * A second and a half is long enough that nobody ends a run by catching
 * the key on the way past, and a tap says no rather than doing it. The
 * face carries the ending the run would take, so what a hold costs is
 * readable before it is held.
 */
@action({ UUID: "com.scrthq.runlog.finish" })
export class Finish extends RunlogAction {
  private holds = new HoldTimer();

  face(state: DeckState): Face {
    return finishFace(state);
  }

  /** The way down is only the start of the clock: this key acts on the way back up. */
  override onKeyDown(ev: KeyDownEvent): void {
    this.holds.down(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const held = (this.holds.up(ev.action.id) ?? 0) >= FINISH_HOLD_MS;
    const p = held ? finishPress(store.state) : null;
    if (!p) {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, p);
  }
}
