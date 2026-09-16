import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { hasProfileFor, installedProfiles } from "../installed.ts";
import { fetchPack, libraryPacks, type LibraryPack } from "../library.ts";
import { apiBase, store } from "../plugin.ts";
import { buildFor, buildForPack, install } from "../profiles-on-demand.ts";
import { installFace, type DeckState, type Face } from "../state.ts";
import { RunlogAction } from "./base.ts";

export type InstallSettings = { pack?: { id: string; title: string } };

/**
 * Builds a profile for a pack in your library and hands it to the Stream Deck app.
 *
 * The Open key's "This pack's profile" builds one for the pack the deck is
 * following, which is the pack it is holding a snapshot of. This one takes
 * any pack the account has synced: the list comes off the library, the pack
 * file comes off the account, and neither needs a run open anywhere.
 *
 * A run of the chosen pack is still the better source where there is one.
 * The snapshot carries the setups for the pack's tool, and the account's
 * copy of the pack file does not, so a profile built from a run has Apply
 * setup keys on it and one built from the file has moves and numbers alone.
 */
@action({ UUID: "com.scrthq.runlog.install" })
export class Install extends RunlogAction<InstallSettings> {
  face(_state: DeckState, settings: InstallSettings): Face {
    return installFace(settings.pack);
  }

  override async onKeyDown(ev: KeyDownEvent<InstallSettings>): Promise<void> {
    const pack = ev.payload.settings.pack;
    if (!pack) {
      await ev.action.showAlert();
      return;
    }
    const device = ev.action.device.type;
    const built = store.state.snapshot?.run?.packId === pack.id ? buildFor(store.state, device) : await this.fromLibrary(pack.id, device);
    if (!built) {
      await ev.action.showAlert();
      return;
    }
    install(built.file);
    await ev.action.showOk();
  }

  /** The pack off the account, laid out. `null` for a pack the account has not synced. */
  private async fromLibrary(id: string, device: number): Promise<{ file: string; bytes: Uint8Array } | null> {
    const pack = await fetchPack(apiBase(), id);
    if (!pack) {
      // A pack that lives only in the browser that imported it. Its own
      // library card builds the profile, which is where the guide sends
      // somebody who lands here.
      streamDeck.logger.info(`profile: ${id} is not synced to this account, so there is no pack file to lay out`);
      return null;
    }
    return buildForPack(pack, device);
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
