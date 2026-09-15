import { action } from "@elgato/streamdeck";

import { runFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

/** Which run the deck is on. Switching between them is Task 11. */
@action({ UUID: "com.scrthq.runlog.run" })
export class Run extends RunlogAction {
  face(state: DeckState): Face {
    return runFace(state);
  }
}
