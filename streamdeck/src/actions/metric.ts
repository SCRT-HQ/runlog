import streamDeck, {
  action,
  type DialDownEvent,
  type DialRotateEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { GLYPHS } from "../glyphs.ts";
import { store } from "../plugin.ts";
import { metricFace, metricPress, type DeckState, type Face, type MetricField, type MetricPress } from "../state.ts";
import { HOLD_MS, HoldTimer, RunlogAction } from "./base.ts";

export type MetricSettings = { field?: MetricField; press?: MetricPress };

/** The fields a dial cycles through. A counter or resource is the run's own and is not on this wheel. */
const FIELDS = ["score", "unit", "clock", "latest", "leader"] as const;

/** The field a dial's rotation lands on, wrapping both ways. */
export function nextField(field: MetricField, by: number): MetricField {
  const i = typeof field === "string" ? FIELDS.indexOf(field) : -1;
  return FIELDS[(i + by + FIELDS.length) % FIELDS.length]!;
}

/**
 * A number from the run: the score, the unit, a clock, the last result, the leader.
 *
 * Set to a counter or a resource it is a key as well as a readout: a tap
 * steps the run's own tracker, a hold takes one back off. The five fixed
 * fields are the run's arithmetic rather than a number anybody keeps by
 * hand, so a press on one of those is refused here rather than sent.
 */
@action({ UUID: "com.scrthq.runlog.metric" })
export class Metric extends RunlogAction<MetricSettings> {
  private holds = new HoldTimer();

  face(state: DeckState, settings: MetricSettings, now: number): Face {
    return settings.field ? metricFace(state, settings.field, now) : { title: "Set up", tone: "dim" };
  }

  /**
   * The bars for a number the run works out, the stepper for one somebody keeps.
   *
   * A counter or a resource is a key as much as a readout, and a deck full
   * of numbers gives no other sign of which ones a press does anything to.
   * The tone stays `readout` either way: the corner is the difference.
   */
  protected override glyph(settings: MetricSettings): string | undefined {
    return typeof settings.field === "object" ? GLYPHS["counter"] : super.glyph(settings);
  }

  /** The way down is only the start of the clock: this key acts on the way back up. */
  override onKeyDown(ev: KeyDownEvent<MetricSettings>): void {
    this.holds.down(ev.action.id);
  }

  override async onKeyUp(ev: KeyUpEvent<MetricSettings>): Promise<void> {
    const { field, press } = ev.payload.settings;
    const p = metricPress(store.state, field, press, (this.holds.up(ev.action.id) ?? 0) >= HOLD_MS);
    if (!p) {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, p);
  }

  /**
   * Pressing the dial steps the field it is on by one.
   *
   * One up whatever the key was set to: a dial has no hold of its own to
   * take one back with, and a number it can only be pushed to is a dial
   * that does the same thing twice.
   */
  override async onDialDown(ev: DialDownEvent<MetricSettings>): Promise<void> {
    const p = metricPress(store.state, ev.payload.settings.field, { kind: "step" }, false);
    if (!p) {
      await ev.action.showAlert();
      return;
    }
    await this.send(ev.action, p);
  }

  /** Rotating a dial steps its field and redraws at once. */
  override async onDialRotate(ev: DialRotateEvent<MetricSettings>): Promise<void> {
    const field = nextField(ev.payload.settings.field ?? "score", Math.sign(ev.payload.ticks));
    await ev.action.setSettings({ ...ev.payload.settings, field });
    await this.draw(ev.action, { ...ev.payload.settings, field });
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

  /** A key gone mid-hold leaves nothing here to time: clear its entry along with the shared cleanup. */
  override onWillDisappear(ev: WillDisappearEvent<MetricSettings>): void {
    this.holds.clear(ev.action.id);
    super.onWillDisappear(ev);
  }
}
