import streamDeck, {
  SingletonAction,
  type Action,
  type DialAction,
  type DidReceiveSettingsEvent,
  type FeedbackPayload,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { faceImage } from "../face.ts";
import { GLYPHS } from "../glyphs.ts";
import { NEO_LAYOUT } from "../layouts.ts";
import { sayWho, store, wire } from "../plugin.ts";
import type { DeckState, Face } from "../state.ts";

/**
 * The JSON shape Stream Deck persists, mirrored rather than imported.
 *
 * `SingletonAction` constrains its settings to `@elgato/utils`' `JsonObject`,
 * which `@elgato/streamdeck` does not re-export; this is the same type,
 * structurally, without depending on a package the plugin does not declare.
 */
type JsonPrimitive = boolean | number | string | null | undefined;
type JsonValue = JsonObject | JsonPrimitive | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** How long a press waits for the server's verdict before giving up on it. */
const VERDICT_MS = 5000;

/** How long a key is held before it counts as a hold rather than a tap. */
export const HOLD_MS = 600;

/** How long the Finish key is held, which is longer because the run ends. */
export const FINISH_HOLD_MS = 1500;

/**
 * A key that tells a hold from a tap.
 *
 * The software sends a key down and a key up and nothing in between, so
 * the length of a press is the plugin's own arithmetic: `down` on the way
 * down, `up` on the way back for how long it was. A key that times a press
 * this way has to act on the way up rather than the way down, which is the
 * one thing that makes it feel different from every other key on the deck.
 */
export class HoldTimer {
  private at = new Map<string, number>();

  down(id: string, now = Date.now()): void {
    this.at.set(id, now);
  }

  /** How long this key was held, or null where the press did not start here - a redraw mid-press, a plugin restart. */
  up(id: string, now = Date.now()): number | null {
    const at = this.at.get(id);
    if (at === undefined) return null;
    this.at.delete(id);
    return now - at;
  }

  /** Drops a pending entry without reading it - a key gone from the deck mid-hold has no `up` coming. */
  clear(id: string): void {
    this.at.delete(id);
  }
}

/**
 * A placement that can be pressed - a key on the grid, or a dial on a
 * Stream Deck +. A Neo's infobar is placed too, but nothing comes back from
 * it, so it is drawn (see `draw`) and never sent from.
 */
export type Placed<S extends JsonObject> = DialAction<S> | KeyAction<S>;
/**
 * What every Runlog action has in common: one state, one wire, one drawing.
 *
 * A subclass says only what its face is. Redrawing is a subscription to the
 * store held while any instance of the action is placed, so a key follows
 * the run without knowing anything about the socket behind it.
 */
export abstract class RunlogAction<S extends JsonObject = JsonObject> extends SingletonAction<S> {
  private unsub: (() => void) | null = null;
  /** What each placement last said, so a change is logged once and a redraw that says the same thing is not. */
  private said = new Map<string, string>();

  /**
   * What this action says, given everything the plugin knows.
   *
   * `on` is the id of the placement being drawn, for the one key that says
   * something about itself rather than about the run: an Install key that
   * just handed a profile over. Every other action ignores it.
   */
  abstract face(state: DeckState, settings: S, now: number, on: string): Face;

  /**
   * The drawing this action wears in the corner of its keys.
   *
   * By the last word of the UUID, which is the name its SVG is filed under
   * in `design/actions`: one home for the pairing, and a new action gets
   * its glyph by being named after its drawing rather than by a table.
   *
   * The settings come in because one action can be two things on a key:
   * Metric set to a counter is a number somebody steps, and it says so in
   * the corner. An action that is one thing ignores them.
   */
  protected glyph(_settings: S): string | undefined {
    return GLYPHS[this.manifestId?.split(".").pop() ?? ""];
  }

  override async onWillAppear(ev: WillAppearEvent<S>): Promise<void> {
    this.unsub ??= store.subscribe(() => this.redrawAll());
    const face = this.face(store.state, ev.payload.settings, Date.now(), ev.action.id);
    // What a key came up saying, which is the only way to read the deck from
    // a log. Once per placement, not once per redraw.
    streamDeck.logger.info(`appeared: ${this.manifestId ?? "?"} says "${face.title}"`);
    // An infobar has no image to take; it is given its layout once, here,
    // and fed the words of every face after.
    if (ev.action.isNeoInfobar()) await ev.action.setFeedbackLayout(NEO_LAYOUT);
    await this.draw(ev.action, ev.payload.settings);
  }

  override onWillDisappear(_ev: WillDisappearEvent<S>): void {
    if (this.actions.length > 0) return;
    this.unsub?.();
    this.unsub = null;
  }

  /** A setting changed in the inspector redraws the key it was changed for. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): Promise<void> {
    await this.draw(ev.action, ev.payload.settings);
  }

  /** Every inspector carries the account block, so every inspector is told who is signed in. */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await sayWho();
  }

  protected async draw(action: Action<S>, settings: S): Promise<void> {
    // The whole redraw is inside the try, the face included: a state a
    // face was not written for, an image the software will not take, a
    // dial that went away mid-write. The SDK's uncaughtException handler
    // is registered `once`, so the second throw anywhere in here would be
    // the plugin's last.
    try {
      const face = this.face(store.state, settings, Date.now(), action.id);
      if (this.said.get(action.id) !== face.title) {
        this.said.set(action.id, face.title);
        streamDeck.logger.info(
          `${this.manifestId ?? "?"} ${action.id} (${action.controllerType}) now says "${face.title}" for ${JSON.stringify(settings)}`,
        );
      }
      if (action.isKey()) {
        await action.setImage(faceImage(face, this.glyph(settings)));
        await action.setTitle("");
      } else if (action.isDial()) {
        // The `$B1` layout's progress bar is the `indicator` key; it only
        // has something to show for a running timer's fraction, controller
        // ruling 4 - anything else leaves it out rather than drawing an
        // empty bar.
        const feedback: FeedbackPayload = { title: face.when ?? "", value: face.title };
        if (face.fraction !== undefined) feedback.indicator = { value: Math.round(face.fraction * 100) };
        await action.setFeedback(feedback);
      } else if (action.isNeoInfobar()) {
        // The same three things as a dial, on `NEO_LAYOUT`'s own keys: the
        // bar is switched off rather than left out, since a layout item
        // once shown stays shown until it is told otherwise.
        const feedback: FeedbackPayload = {
          label: face.when ?? "",
          value: face.title,
          indicator: face.fraction === undefined ? { enabled: false } : { enabled: true, value: Math.round(face.fraction * 100) },
        };
        await action.setFeedback(feedback);
      }
    } catch (error) {
      // The software answers nothing on a bad image; a throw here is the
      // only word of it there is, and it is worth a line in the log.
      streamDeck.logger.error(`could not draw ${action.id}: ${String(error)}`);
    }
  }

  private redrawAll(): void {
    // The settings read can reject too, and a rejection with nothing on it
    // is an unhandled one.
    for (const a of this.actions)
      void a
        .getSettings()
        .then((s) => this.draw(a, s))
        .catch((error) => streamDeck.logger.error(`could not redraw ${a.id}: ${String(error)}`));
  }

  /**
   * A press, with the flash the server's answer will turn into.
   *
   * The wait is bounded two ways, because a verdict that never comes would
   * otherwise leave a listener on the store for the life of the plugin: the
   * deck going off ends it silently, and a press still unanswered after
   * {@link VERDICT_MS} ends it with the alert - a press that vanished should
   * say so rather than nothing.
   */
  protected async send(action: Placed<S>, p: Parameters<typeof wire.press>[0]): Promise<void> {
    const ref = wire.press(p);
    if (!ref) {
      await action.showAlert();
      return;
    }
    let off: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = (): boolean => {
      if (off === null) return false;
      if (timer) clearTimeout(timer);
      off();
      off = null;
      return true;
    };
    off = store.subscribe((s) => {
      if (!s.on) {
        stop();
        return;
      }
      if (s.flash?.ref !== ref) return;
      const ok = s.flash.ok;
      if (!stop()) return;
      void (ok && action.isKey() ? action.showOk() : action.showAlert());
    });
    timer = setTimeout(() => {
      if (stop()) void action.showAlert();
    }, VERDICT_MS);
  }
}
