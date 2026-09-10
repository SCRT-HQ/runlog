# Selling copies from your own backend

Runlog's selling tools come in two shapes, and this page is the free one:
issue sealed copies of your pack from your own checkout, with your own keys,
on your own server, and no Runlog service in the loop. The hosted shape, where
Runlog keeps the ledger of who bought what and places a purchase straight
into a buyer's account, is a publisher subscription and is described in the
app; everything below works without it.

**Any file in the shape described
here opens in the Runlog app, on any address, with the key you issued, and
nothing is checked online.** The app does not phone home to ask whether a
sale was real. It cannot; there is nothing to ask.

## The shortest version

```bash
npm install @scrthq/runlog
```

```js
import { seal, generateLicenseKey } from "@scrthq/runlog";

// `pack` is your signed pack, parsed from YAML or JSON into an object.
const key = generateLicenseKey();
const bytes = await seal(pack, key, { ref: order.id, title: pack.title });

await email(buyer, {
  attachment: { name: `${pack.id}.rlpack`, bytes },
  text: `Your license key is ${key}. Open the file in Runlog and type it once.`,
});
```

That is the whole integration. Run it from a Stripe webhook, a Gumroad
notification, an itch.io download hook, a spreadsheet script; the package
does not care what called it. The library entry point runs on Node 20 and
later and in browsers, and pulls in nothing; the same package carries the
`runlog` command, so one install gives a backend both.

The same thing from the command line, one buyer at a time or in a loop:

```bash
npx @scrthq/runlog issue my-game.yaml --to "Buyer Name" --ref order-8f3a \
  --key my-key.json --seal
```

## What a sealed copy is

A `.rlpack` file is a container, not a pack. Your working file stays plain
YAML and every tool keeps working on it; the container is what you send.

| Part | Bytes | Holds |
| --- | --- | --- |
| magic | 6 | the ASCII string `RLPACK` |
| header length | 4 | big-endian unsigned integer: the header's byte length |
| header | as stated | UTF-8 JSON, in the clear (below) |
| body | the rest | AES-256-GCM ciphertext of the UTF-8 JSON of the document, with the 16-byte tag appended as Web Crypto emits it |

The header:

```json
{
  "v": 1,
  "alg": "aes-256-gcm",
  "kdf": "pbkdf2-sha256",
  "iterations": 600000,
  "salt": "<16 random bytes, base64url, unpadded>",
  "iv": "<12 random bytes, base64url, unpadded>",
  "ref": "order-8f3a",
  "title": "The Long Kiln"
}
```

`ref` and `title` are optional and yours. `ref` is your own reference for the
sale, so a file that turns up somewhere public can be traced through your
records without opening it. `title` is shown by the app before it asks for a
key, so the prompt can name what it is for. Neither is the buyer's name, on
purpose: a leaked file should not publish someone's name to everyone who
downloads it. The name, if you stamp one, lives inside the encrypted body.

The key derivation: the license key is normalized (trimmed, upper-cased,
everything but `A-Z` and `0-9` removed) and run through PBKDF2-HMAC-SHA-256
with the header's salt and iteration count to make the 256-bit AES key.
Six hundred thousand iterations is deliberate; it makes a guessed key cost
about a second per try on a phone, and a real one a moment on open.

A fresh salt and IV per copy means two buyers' files never look alike, even
for the same pack and key.

## License keys

`generateLicenseKey()` makes twenty characters from an alphabet without the
ones people confuse (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), grouped in fives:
`H7KQM-3XW2P-ZR8TN-A5CDE`. That is about a hundred bits, chosen from a
receipt by a person who wants to play. You can use any string as a key; the
app accepts whatever you issued, spacing and case ignored. Keys are per copy.
Issuing one key for every buyer of a pack is allowed by the format and a bad
idea for the reason the format exists.

## What this protects, and what it does not

It stops the leak that happens in practice: a buyer opening the file they
downloaded, deleting the two lines that name them, and re-uploading it. A
sealed file is binary, so an editor shows nothing to delete; without the key
it is inert, so passing the file on means passing on a key issued to one
person; and if you stamped the copy with `runlog issue`, the buyer's name is
inside the signed document, so a copy that has been opened, edited and
re-sealed either still names them or no longer verifies as yours.

It does not stop someone determined. The app must show the rules to play
them, so a person willing to read their own browser's memory, or to build
the open-source app with one line changed, reaches the plaintext. It does not
stop anyone retyping the game from a book. Those are out of scope by design.

## Signing, and what the stamp needs

Sealing hides a document; signing proves who released it. They are separate,
and the seal wraps the signature: sign first, seal second, and the app
verifies the signature after opening, against the same bytes you signed.

Stamping a buyer's name *inside* the signature (`runlog issue --to`) needs
your private signing key at issue time, because the stamped document is a
new document and must be signed again. That is why `runlog issue` takes
`--key`. If your backend holds your signing key, it can do the same with
`signPack` from the CLI's library; if you would rather it did not, seal the
already-signed master without a stamp, and rely on `ref` in the header to
trace a copy. Runlog's own hosted issuing works that way, so that no
creator's key lives on Runlog's server.

## What the app does with it

Opening a `.rlpack` in the app asks for the key once. A signed-in player's
key is kept in their account, so the same file opens on their other devices
without the receipt; a player without an account keeps it in the browser. If
you ever need to know whether the app is treating your file as sealed, look
for "your sealed copy" under the pack's name on the shelf.

## Reference

```ts
seal(document: unknown, licenseKey: string, extra?: { ref?: string; title?: string }): Promise<Uint8Array>
open(bytes: Uint8Array, licenseKey: string): Promise<
  | { ok: true; document: unknown }
  | { ok: false; reason: "not-sealed" | "unsupported" | "wrong-key" | "damaged"; message: string }
>
readHeader(bytes: Uint8Array): ContainerHeader | null
isSealed(bytes: Uint8Array): boolean
generateLicenseKey(): string
```

The source is `packages/container` in the Runlog repository, published as the
library half of `@scrthq/runlog`, and is a few hundred lines; if this page and the code disagree, the code is right and the
page has a bug.
