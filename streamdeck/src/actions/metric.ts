import streamDeck, { action, type DialRotateEvent } from "@elgato/streamdeck";

import { store } from "../plugin.ts";
import { metricFace, type DeckState, type Face, type MetricField } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type MetricSettings = { field?: MetricField };

/** The fields a dial cycles through. A counter or resource is the run's own and is not on this wheel. */
const FIELDS = ["score", "unit", "clock", "latest", "leader"] as const;

/** The field a dial's rotation lands on, wrapping both ways. */
export function nextField(field: MetricField, by: number): MetricField {
  const i = typeof field === "string" ? FIELDS.indexOf(field) : -1;
  return FIELDS[(i + by + FIELDS.length) % FIELDS.length]!;
}

/** A number from the run: the score, the unit, a clock, the last result, the leader. */
@action({ UUID: "com.scrthq.runlog.metric" })
export class Metric extends RunlogAction<MetricSettings> {
  face(state: DeckState, settings: MetricSettings, now: number): Face {
    return settings.field ? metricFace(state, settings.field, now) : { title: "Set up", tone: "dim" };
  }

  /** Rotating a dial steps its field and redraws at once. */
  override async onDialRotate(ev: DialRotateEvent<MetricSettings>): Promise<void> {
    const field = nextField(ev.payload.settings.field ?? "score", Math.sign(ev.payload.ticks));
    await ev.action.setSettings({ field });
    await this.draw(ev.action, { field });
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
