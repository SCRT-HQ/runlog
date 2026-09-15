import streamDeck from "@elgato/streamdeck";

import { Metric } from "./actions/metric";
import { Next } from "./actions/next";
import { Press } from "./actions/press";
import { Run } from "./actions/run";
import { Undo } from "./actions/undo";

streamDeck.logger.setLevel("info");

for (const a of [new Next(), new Press(), new Undo(), new Run(), new Metric()]) {
  streamDeck.actions.registerAction(a);
}

streamDeck.connect();
