import { useCallback, useEffect, useState } from "react";
import { loadPackText } from "@runlog/rules-schema";
import { useApi } from "../sync/useApi.ts";
import { hashText } from "../sync/hash.ts";
import type { Guild } from "../sync/client.ts";
import type { StoredPack } from "../storage/db.ts";

/**
 * The Discord servers this account claimed, and which of its packs each
 * server's vault is holding.
 *
 * Read once for the whole shelf rather than once by every row: an account
 * may claim three servers, and ten pack rows each asking for themselves
 * would ask thirty times to draw one page. The rows share this, and a row
 * that puts a pack in a vault updates what the others are showing.
 *
 * Empty where there is nothing to ask, so a copy with no server behind it,
 * or nobody signed in, draws the shelf it always drew.
 */
export interface GuildVaults {
  guilds: Guild[];
  /** The pack ids in each server's vault, by server. */
  holding: Record<string, ReadonlySet<string>>;
  /** Which server a pack is being put in or taken out of, as `<guildId>:<packId>`. */
  busy: string | null;
  /** Put a pack in a server's vault, or take it out. Returns what to say about it. */
  set: (pack: StoredPack, guildId: string, on: boolean) => Promise<string | null>;
}

export function useGuildVaults(): GuildVaults {
  const api = useApi();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [holding, setHolding] = useState<Record<string, ReadonlySet<string>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!api) {
      setGuilds([]);
      setHolding({});
      return;
    }
    let live = true;
    void api.myGuilds().then(
      async (known) => {
        if (!live) return;
        setGuilds(known.guilds);
        const all: Record<string, ReadonlySet<string>> = {};
        for (const g of known.guilds) {
          const packs = await api.guildPacks(g.guildId).catch(() => []);
          all[g.guildId] = new Set(packs.map((p) => p.id));
        }
        if (live) setHolding(all);
      },
      () => {
        if (live) setGuilds([]);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const set = useCallback<GuildVaults["set"]>(
    async (pack, guildId, on) => {
      if (!api) return null;
      const mark = `${guildId}:${pack.id}`;
      setBusy(mark);
      try {
        if (!on) {
          await api.undelegatePack(guildId, pack.id);
          setHolding((v) => ({ ...v, [guildId]: new Set([...(v[guildId] ?? [])].filter((id) => id !== pack.id)) }));
          return null;
        }
        // The text goes up whole, so the bot can play without this device.
        // A sealed copy has no text to send until it is opened here.
        const parsed = loadPackText(pack.source, pack.format);
        if (!parsed.ok) return "That pack does not load as it is; open it in the Designer first.";
        const modes = Object.entries(parsed.pack.modes).map(([id, m]) => ({ id, label: m.label ?? id }));
        const kept = await api.delegatePack(guildId, {
          packId: pack.id,
          title: pack.title,
          version: pack.version,
          format: pack.format,
          hash: await hashText(pack.source),
          modes,
          source: pack.source,
        });
        setHolding((v) => ({ ...v, [guildId]: new Set([...(v[guildId] ?? []), kept.id]) }));
        return null;
      } catch (error) {
        return error instanceof Error && error.message ? error.message : "That did not go through; try again in a moment.";
      } finally {
        setBusy(null);
      }
    },
    [api],
  );

  return { guilds, holding, busy, set };
}
