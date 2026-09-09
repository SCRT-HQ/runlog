import { loadPackText, open, readHeader, type Pack } from "@runlog/rules-schema";
import YAML from "yaml";
import type { Api, Purchase } from "./client.ts";
import type { SyncDb } from "./engine.ts";

/**
 * What the account bought, brought onto this device.
 *
 * A sealed copy's text never syncs: the server does not hold it as a pack
 * and the app never sends it. What the server does hold is the sale, the
 * sealed file under the publisher, the key under the buyer, so a device
 * that signs in can fetch each bought copy once and keep it as if the
 * receipt's link had been opened here. After that it is an ordinary
 * sealed pack on the shelf, with its key filed beside it.
 *
 * A copy forgotten on this device is not brought back on the next pass;
 * the catalog offers it again instead, since forgetting was a choice.
 */

const SETTLED = "runlog:purchases:settled";

function settled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SETTLED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function remember(refs: Set<string>): void {
  try {
    localStorage.setItem(SETTLED, JSON.stringify([...refs]));
  } catch {
    /* a browser with no storage settles again next time */
  }
}

/** Open a fetched copy with its key and keep it; the pack's id once it is on the shelf. */
export async function keepPurchase(db: Pick<SyncDb, "savePack" | "saveLicense">, purchase: Purchase, bytes: Uint8Array): Promise<string | null> {
  const got = await openPurchase(purchase, bytes);
  if (!got) return null;
  const { header, text, pack } = got;
  const at = new Date().toISOString();
  await db.savePack({
    id: pack.id,
    title: pack.title,
    version: pack.version,
    source: text,
    format: "yaml",
    filename: header.title ?? pack.title,
    importedAt: at,
    updatedAt: at,
    sealed: true,
    origin: "listing",
    catalog: { id: purchase.packId, version: pack.version },
  });
  await db.saveLicense({
    packId: pack.id,
    key: purchase.key ?? "",
    ...(header.ref ? { ref: header.ref } : {}),
    ...(header.title ? { title: header.title } : {}),
    updatedAt: at,
  });
  return pack.id;
}

/**
 * A purchased copy opened with its key: the pack's text as YAML and the
 * pack itself. Null when the bytes are not a sealed pack, the key does
 * not open it, or what is inside is not a pack.
 */
export async function openPurchase(purchase: Purchase, bytes: Uint8Array): Promise<{ header: ReturnType<typeof readHeader> & object; text: string; pack: Pack } | null> {
  if (!purchase.key) return null;
  const header = readHeader(bytes);
  if (!header) return null;
  const opened = await open(bytes, purchase.key);
  if (!opened.ok) return null;
  const text = YAML.stringify(opened.document, { lineWidth: 90 });
  const parsed = loadPackText(text, "yaml");
  if (!parsed.ok) return null;
  return { header, text, pack: parsed.pack };
}

/**
 * Fetch every fulfilled purchase this device has not seen and whose pack
 * is not on the shelf. Never throws: a purchase that will not come is
 * left for the next pass, and the catalog's own button.
 */
export async function settlePurchases(api: Pick<Api, "myPurchases" | "purchaseFile">, db: SyncDb): Promise<string[]> {
  const arrived: string[] = [];
  let purchases: Purchase[];
  try {
    purchases = await api.myPurchases();
  } catch {
    return arrived;
  }
  const seen = settled();
  for (const purchase of purchases) {
    if (purchase.status !== "fulfilled" || !purchase.key || seen.has(purchase.ref)) continue;
    const existing = await db.loadPack(purchase.packId);
    if (existing && !existing.deletedAt) {
      seen.add(purchase.ref);
      continue;
    }
    try {
      const id = await keepPurchase(db, purchase, await api.purchaseFile(purchase.ref));
      if (id) {
        seen.add(purchase.ref);
        arrived.push(id);
      }
    } catch {
      /* next pass */
    }
  }
  remember(seen);
  return arrived;
}
