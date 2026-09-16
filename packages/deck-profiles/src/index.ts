/**
 * A Stream Deck profile built from a pack, in Node or in a browser.
 *
 * `streamdeck/design/profiles.mjs` runs this over the packs in the
 * repository and commits the forty-four files the plugin ships. A pack
 * from the Marketplace is not known when the plugin is packed, so its own
 * page runs the same code on the pack it is showing and hands over the
 * bytes. Nothing here touches the filesystem or a Node built-in, which is
 * what lets both callers be the same code rather than two that drift.
 */

export { BASE, DEVICE_IDS, DEVICES, DIALS, isWarp, type Device, type DeviceId, type Key } from "./layouts.ts";
export { ACTION_NAMES, PAGE_PLUGIN, PLUGIN, TURNS } from "./plugin.ts";
export {
  container,
  fromOffer,
  fromPack,
  GENERIC,
  hasKeys,
  laysOut,
  packKeys,
  paginate,
  profile,
  specs,
  specsFor,
  stableId,
  type Built,
  type Controller,
  type Keyed,
  type Offered,
  type Page,
  type PageFile,
  type ProfileSpec,
  type RootFile,
  type StoredAction,
} from "./profiles.ts";
export { zip, type ZipEntry } from "./zip.ts";
