import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { hasProfileFor, installedFor, installedProfiles } from "../installed.ts";
import { fetchPack, libraryPacks, type LibraryPack } from "../library.ts";
import { apiBase, store } from "../plugin.ts";
import { buildFor, buildForPack, install } from "../profiles-on-demand.ts";
import { importedAsCopy, installFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type InstallSettings = { pack?: { id: string; title: string } };

/**
 * Builds a profile for a pack in your library and hands it to the Stream Deck app.
 *
 * The only key that hands a profile over. It takes any pack the account
 * has synced rather than the one the deck happens to be following: the
 * list comes off the library, the pack file comes off the account, and
 * neither needs a run open anywhere.
 *
 * A run of the chosen pack is still the better source where there is one:
 * its offer names the setups for the pack's tool, which is the one place a
 * pack from the Marketplace names them at all. Without a run they come off
 * the shipped table and off what the deck has seen on earlier runs of the
 * pack, so both paths lay out the same keys.
 */
@action({ UUID: "com.scrthq.runlog.install" })
export class Install extends RunlogAction<InstallSettings> {
  face(state: DeckState, settings: InstallSettings, _now: number, on: string): Face {
    return installFace(state, settings.pack, on);
  }

  override async onKeyDown(ev: KeyDownEvent<InstallSettings>): Promise<void> {
    const pack = ev.payload.settings.pack;
    if (!pack) {
      streamDeck.logger.info("profile: the install key has no pack set");
      await ev.action.showAlert();
      return;
    }
    const device = ev.action.device.type;
    // The run first where the deck is on one of this pack: its offer names
    // the setups first-hand rather than from a table or a memory. It comes
    // back with nothing where the run has published no layout and no offer
    // yet, and the pack file covers exactly that, so the fall-through is
    // not a failure path.
    const fromRun = store.state.snapshot?.run?.packId === pack.id ? buildFor(store.state, device) : null;
    const built = fromRun ?? (await this.fromLibrary(pack.id, device));
    if (!built) {
      await ev.action.showAlert();
      return;
    }
    install(built.file);
    // Read after the hand-over, which is the same answer as before it: the
    // app asks the streamer before it imports anything, so the folder still
    // holds what it held when the key went down.
    if (installedFor(pack, installedProfiles()) !== null) {
      streamDeck.logger.info(`profile: ${pack.id} already had one, so the app will name this one a copy`);
      store.dispatch({ t: "drove", ref: importedAsCopy(ev.action.id), ok: true });
    }
    await ev.action.showOk();
  }

  /**
   * The pack off the account, laid out.
   *
   * `null` with a line in the log saying which of the ways it went: a pack
   * the account never synced is the one the guide answers, by sending
   * somebody to that pack's library card, and telling them to go there when
   * the source is malformed or the server is down helps nobody.
   */
  private async fromLibrary(id: string, device: number): Promise<{ file: string; bytes: Uint8Array } | null> {
    const found = await fetchPack(apiBase(), id);
    if (!found.ok) {
      streamDeck.logger.info(`profile: ${id} ${found.say}`);
      return null;
    }
    const built = buildForPack(found.pack, device);
    if (!built) {
      // A Pedal or a Neo, which this package lays no grid out for, or a
      // pack with no moves and no numbers of its own: the generic profile
      // the plugin installs is already that layout.
      streamDeck.logger.info(`profile: nothing to lay out for ${id} on this deck`);
    }
    return built;
  }

  /**
   * The library, split by whether the Stream Deck app already has a profile.
   *
   * Two lists rather than one, because importing a profile twice does not
   * replace the first: the app keeps both. The packs with none are what
   * somebody is usually here for, so those are the first list and the rest
   * are the second.
   */
  override async onPropertyInspectorDidAppear(): Promise<void> {
    await super.onPropertyInspectorDidAppear();
    const packs = await libraryPacks(apiBase());
    const profiles = installedProfiles();
    const has = (p: LibraryPack): boolean => hasProfileFor(p, profiles);
    const listed = (of: LibraryPack[]): Array<{ id: string; title: string }> => of.map(({ id, title }) => ({ id, title }));
    await streamDeck.ui.sendToPropertyInspector({
      t: "packs",
      without: listed(packs.filter((p) => !has(p))),
      with: listed(packs.filter(has)),
    });
  }
}
