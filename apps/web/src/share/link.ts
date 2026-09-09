import { fromBase64Url, toBase64Url } from "@runlog/rules-schema";

/**
 * A pack in a link.
 *
 * The alternative is hosting: put the file somewhere, hand out a URL, and now
 * there is a server, an uptime problem, and a log of who opened your game. For
 * something this small that is a lot of machinery to acquire.
 *
 * So the pack travels in the URL's *fragment*, which browsers never send to
 * any server. A link like this can be pasted into a chat, mailed, or written
 * on a card, and the person who opens it has the pack, with nothing in
 * between having seen it, and nothing to keep running afterwards.
 *
 * The cost is length. Compressed, the demo pack is about 7,600 characters and
 * a large one around 19,000. That is fine in a mail or a document and too long
 * for chat apps that cap a message, which is why `describeLength` says so
 * rather than leaving someone to find out when their paste is truncated.
 */

/** What a shareable link's fragment starts with. */
export const LINK_PREFIX = "#pack=";

/**
 * `1` is the format version, then the codec: `g` gzip, `r` raw.
 *
 * Spelled out in the link so a reader that meets a future codec can say so
 * instead of producing nonsense, and so an environment without compression
 * can still make a link that everyone can open.
 */
type Codec = "g" | "r";

const supportsCompression = () => typeof CompressionStream === "function";

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return collect(stream as ReadableStream<Uint8Array>);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return collect(stream as ReadableStream<Uint8Array>);
}

/**
 * Encode a pack into a fragment.
 *
 * Takes the raw document rather than a validated pack, so whatever the author
 * wrote travels: including a signature, which would otherwise be stripped by
 * a round trip through the schema and leave the recipient unable to check it.
 */
export async function encodePack(document: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const codec: Codec = supportsCompression() ? "g" : "r";
  const bytes = codec === "g" ? await gzip(json) : json;
  return `${LINK_PREFIX}1${codec}.${toBase64Url(bytes)}`;
}

/** The whole link, ready to paste. */
export async function encodePackLink(document: unknown, base = location.href): Promise<string> {
  const url = new URL(base);
  url.hash = "";
  return `${url.toString().replace(/#$/, "")}${await encodePack(document)}`;
}

export type DecodeResult =
  | { ok: true; document: unknown }
  | { ok: false; error: string };

export async function decodePack(fragment: string): Promise<DecodeResult> {
  const body = fragment.startsWith(LINK_PREFIX)
    ? fragment.slice(LINK_PREFIX.length)
    : fragment.replace(/^#/, "");
  if (!body) return { ok: false, error: "there is no pack in this link" };

  const dot = body.indexOf(".");
  const header = dot === -1 ? "" : body.slice(0, dot);
  const data = dot === -1 ? "" : body.slice(dot + 1);

  if (header.length !== 2 || header[0] !== "1") {
    return { ok: false, error: "this link was made by a newer version of the app" };
  }
  const codec = header[1] as Codec;
  if (codec !== "g" && codec !== "r") {
    return { ok: false, error: "this link is compressed in a way this version does not know" };
  }
  if (codec === "g" && typeof DecompressionStream !== "function") {
    return { ok: false, error: "this browser cannot decompress the link" };
  }

  try {
    const raw = fromBase64Url(data);
    const json = codec === "g" ? await gunzip(raw) : raw;
    const document = JSON.parse(new TextDecoder().decode(json)) as unknown;
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      return { ok: false, error: "this link does not contain a pack" };
    }
    return { ok: true, document };
  } catch {
    // Links get truncated by chat apps, wrapped by mail clients, and clipped
    // by hand. Saying which is impossible; saying that it happened is not.
    return { ok: false, error: "this link is damaged or incomplete" };
  }
}

/**
 * What a link's length means for sharing it.
 *
 * Nothing here is a limit the app imposes: a fragment never reaches a server,
 * and browsers accept far longer. The limits that bite belong to whatever the
 * link is pasted into, so those are what get named.
 */
export function describeLength(link: string): { ok: boolean; text: string } {
  const n = link.length;
  const round = n.toLocaleString();
  if (n <= 2000) return { ok: true, text: `${round} characters, short enough to paste anywhere` };
  if (n <= 30000) {
    return {
      ok: true,
      text: `${round} characters, fine in a mail or a document, too long for most chat apps`,
    };
  }
  return {
    ok: false,
    text: `${round} characters, long enough that many places will truncate it. Send the file instead.`,
  };
}
