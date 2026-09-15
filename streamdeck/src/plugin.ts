import streamDeck from "@elgato/streamdeck";

import { Metric } from "./actions/metric";
import { Next } from "./actions/next";
import { Press } from "./actions/press";
import { Run } from "./actions/run";
import { Undo } from "./actions/undo";
import { openWire } from "./socket.ts";
import { makeStore } from "./store.ts";

streamDeck.logger.setLevel("info");

export const store = makeStore();
export const wire = openWire({ apiBase: process.env["RUNLOG_API"] ?? "https://runlog.scrthq.com" }, store);

for (const a of [new Next(), new Press(), new Undo(), new Run(), new Metric()]) {
  streamDeck.actions.registerAction(a);
}

streamDeck.connect();
