/**
 * The sealed-copy container, on its own.
 *
 * This is the part of Runlog a seller's backend needs and nothing else: seal
 * a pack behind a license key, read a sealed file's clear header, open one
 * with its key, and make keys people can type. It has no idea what a pack
 * is, it seals a JSON document, and no opinion about who is selling, so
 * it depends on nothing and runs wherever Web Crypto does: Node 20 and up,
 * and every current browser.
 *
 * The format is documented in docs/selling.md, and the promise the app makes
 * about it is the reason this package exists: any file in this shape opens
 * with its key, on any address, with nothing checked online.
 */
export {
  generateLicenseKey,
  isSealed,
  open,
  readHeader,
  seal,
  type ContainerHeader,
  type OpenResult,
} from "./container.ts";
export { fromBase64Url, toBase64Url } from "./base64url.ts";
