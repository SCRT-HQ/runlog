import streamDeck, { action } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { metricFace, type DeckState, type Face, type MetricField } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type MetricSettings = { field?: MetricField };

/** A number from the run: the score, the unit, a clock, the last result, the leader. */
@action({ UUID: "com.scrthq.runlog.metric" })
export class Metric extends RunlogAction<MetricSettings> {
  face(state: DeckState, settings: MetricSettings, now: number): Face {
    return settings.field ? metricFace(state, settings.field, now) : { title: "Set up", tone: "dim" };
  }

  /** The fixed fields are known to the inspector; the counters and resources are the run's own. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    const snap = store.state.snapshot;
    await streamDeck.ui.sendToPropertyInspector({
      t: "fields",
      counters: snap?.counters?.map((c) => ({ id: c.id, label: c.label })) ?? [],
      resources: snap?.resources?.map((r) => ({ id: r.id, label: r.label })) ?? [],
    });
  }
}
