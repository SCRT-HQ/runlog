import type { ClaimCode, Connection, Guild, GuildPackMeta, GuildStore, LinkCode } from "../lib/handlers/guilds";

/** Discord's rows, in Maps, with the same rules as the real one: a code is spent by being read, a link or a claim replaces on both sides, and a vault never hands its packs back. */
export function memoryGuilds(): GuildStore & { codes: Map<string, LinkCode>; claims: Map<string, ClaimCode>; links: Map<string, Connection>; guilds: Map<string, Guild>; vault: Map<string, { meta: GuildPackMeta; source: string }> } {
  const codes = new Map<string, LinkCode>();
  const claims = new Map<string, ClaimCode>();
  const links = new Map<string, Connection>();
  const owners = new Map<string, string>();
  const guilds = new Map<string, Guild>();
  const vault = new Map<string, { meta: GuildPackMeta; source: string }>();
  const packsOf = (guildId: string) => [...vault.entries()].filter(([k]) => k.startsWith(`${guildId}/`));
  const release = (guildId: string) => {
    if (!guilds.has(guildId)) return 0;
    const packs = packsOf(guildId);
    for (const [k] of packs) vault.delete(k);
    guilds.delete(guildId);
    return packs.length + 2;
  };
  return {
    codes,
    claims,
    links,
    guilds,
    vault,
    async putLinkCode(link) {
      codes.set(link.code, { ...link });
    },
    async takeLinkCode(code, at) {
      const found = codes.get(code);
      codes.delete(code);
      if (!found || found.expiresAt < at) return null;
      return { ...found };
    },
    async connect(sub, c) {
      const previousOwner = owners.get(c.discordUserId);
      if (previousOwner && previousOwner !== sub) links.delete(previousOwner);
      const previous = links.get(sub);
      if (previous && previous.discordUserId !== c.discordUserId) owners.delete(previous.discordUserId);
      links.set(sub, { ...c });
      owners.set(c.discordUserId, sub);
    },
    async connection(sub) {
      const c = links.get(sub);
      return c ? { ...c } : null;
    },
    async userForDiscord(discordUserId) {
      return owners.get(discordUserId) ?? null;
    },
    async disconnect(sub) {
      const had = links.get(sub);
      if (!had) return false;
      links.delete(sub);
      owners.delete(had.discordUserId);
      return true;
    },
    async putClaimCode(claim) {
      claims.set(claim.code, { ...claim });
    },
    async takeClaimCode(code, at) {
      const found = claims.get(code);
      claims.delete(code);
      if (!found || found.expiresAt < at) return null;
      return { ...found };
    },
    async claimGuild(g) {
      const made: Guild = { ...g, updatedAt: g.claimedAt };
      guilds.set(g.guildId, made);
      return { ...made };
    },
    async guild(guildId) {
      const g = guilds.get(guildId);
      return g ? { ...g } : null;
    },
    async guildsOf(sub) {
      return [...guilds.values()].filter((g) => g.ownerSub === sub).map((g) => ({ ...g }));
    },
    async updateGuild(guildId, at, patch) {
      const g = guilds.get(guildId);
      if (!g) return null;
      if (patch.name !== undefined) g.name = patch.name;
      for (const field of ["hostRoleId", "channelId"] as const) {
        if (patch[field] === undefined) continue;
        if (patch[field] === null) delete g[field];
        else g[field] = patch[field] as string;
      }
      g.updatedAt = at;
      return { ...g };
    },
    async releaseGuild(guildId) {
      return release(guildId);
    },
    async putGuildPack(guildId, meta, source) {
      vault.set(`${guildId}/${meta.id}`, { meta: { ...meta }, source });
    },
    async getGuildPack(guildId, packId) {
      const p = vault.get(`${guildId}/${packId}`);
      return p ? { meta: { ...p.meta }, source: p.source } : null;
    },
    async listGuildPacks(guildId) {
      return packsOf(guildId).map(([, p]) => ({ ...p.meta }));
    },
    async deleteGuildPack(guildId, packId) {
      return vault.delete(`${guildId}/${packId}`);
    },
    async forgetUser(sub) {
      let rows = 0;
      const had = links.get(sub);
      if (had) {
        links.delete(sub);
        owners.delete(had.discordUserId);
        rows += 2;
      }
      for (const g of [...guilds.values()]) if (g.ownerSub === sub) rows += release(g.guildId);
      return rows;
    },
  };
}
