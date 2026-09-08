import type { Connection, GuildStore, LinkCode } from "../lib/handlers/guilds";

/** Discord's rows, in Maps, with the same rules as the real one: a code is spent by being read, and a link replaces on both sides. */
export function memoryGuilds(): GuildStore & { codes: Map<string, LinkCode>; links: Map<string, Connection> } {
  const codes = new Map<string, LinkCode>();
  const links = new Map<string, Connection>();
  const owners = new Map<string, string>();
  return {
    codes,
    links,
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
    async forgetUser(sub) {
      const had = links.get(sub);
      if (!had) return 0;
      links.delete(sub);
      owners.delete(had.discordUserId);
      return 2;
    },
  };
}
