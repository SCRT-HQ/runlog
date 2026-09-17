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

export {
  BASE,
  DEVICE_IDS,
  DEVICES,
  DIALS,
  FRAMES,
  POOLS,
  SPILLS,
  UTILITY,
  UTILITY_PAGE,
  isWarp,
  type Device,
  type DeviceId,
  type Frame,
  type Key,
  type Pool,
  type Queued,
} from "./layouts.ts";
export { ACTION_NAMES, PAGE_PLUGIN, PLUGIN, TURNS } from "./plugin.ts";
export {
  container,
  framedPages,
  fromOffer,
  fromPack,
  GENERIC,
  hasKeys,
  laysOut,
  packKeys,
  paginate,
  profile,
  queuesFor,
  shippedName,
  specs,
  specsFor,
  stableId,
  type Built,
  type Controller,
  type FramedPage,
  type Handed,
  type Keyed,
  type Laid,
  type Offered,
  type Page,
  type PageFile,
  type ProfileSpec,
  type Queues,
  type RootFile,
  type StoredAction,
  type Zones,
} from "./profiles.ts";
export { zip, type ZipEntry } from "./zip.ts";
