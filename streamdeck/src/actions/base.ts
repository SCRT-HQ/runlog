import streamDeck, {
  SingletonAction,
  type DialAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { faceImage } from "../face.ts";
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

/** Either kind of placed action - a key on the grid, or a dial on a Stream Deck +. */
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

  /** What this action says, given everything the plugin knows. */
  abstract face(state: DeckState, settings: S, now: number): Face;

  override async onWillAppear(ev: WillAppearEvent<S>): Promise<void> {
    this.unsub ??= store.subscribe(() => this.redrawAll());
    const face = this.face(store.state, ev.payload.settings, Date.now());
    // What a key came up saying, which is the only way to read the deck from
    // a log. Once per placement, not once per redraw.
    streamDeck.logger.info(`appeared: ${this.manifestId ?? "?"} says "${face.title}"`);
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

  protected async draw(action: Placed<S>, settings: S): Promise<void> {
    const face = this.face(store.state, settings, Date.now());
    if (action.isKey()) {
      await action.setImage(faceImage(face));
      await action.setTitle("");
    } else if (action.isDial()) {
      await action.setFeedback({ title: face.when ?? "", value: face.title });
    }
  }

  private redrawAll(): void {
    for (const a of this.actions) void a.getSettings<S>().then((s) => this.draw(a, s));
  }

  /** A press, with the flash the server's answer will turn into. */
  protected async send(action: Placed<S>, p: Parameters<typeof wire.press>[0]): Promise<void> {
    const ref = wire.press(p);
    if (!ref) {
      await action.showAlert();
      return;
    }
    const off = store.subscribe((s) => {
      if (s.flash?.ref !== ref) return;
      off();
      void (s.flash.ok && action.isKey() ? action.showOk() : action.showAlert());
    });
  }
}
