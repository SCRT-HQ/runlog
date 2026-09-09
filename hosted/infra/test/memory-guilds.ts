import type { ClaimCode, Connection, Guild, GuildPackMeta, GuildRun, GuildStore, LinkCode, VerifyState } from "../lib/handlers/guilds";
import type { DiscordMessage, DiscordOAuth, DiscordRest } from "../lib/handlers/discord/rest";

/** Discord, as a list of what was asked of it: threads made, messages posted, in order. */
export function memoryDiscord(): DiscordRest & {
  threads: string[];
  /** The ids of the threads that were made private, so a test can tell which kind was asked for. */
  privateThreads: string[];
  /** Who was put in a thread, in order; a private thread is empty but for the bot until somebody is. */
  threadMembers: Array<{ thread: string; user: string }>;
  posts: Array<{ channel: string; message: DiscordMessage; id: string }>;
  edits: Array<{ channel: string; id: string; message: DiscordMessage }>;
  originals: Array<{ token: string; message: DiscordMessage }>;
  pins: string[];
  deleted: string[];
  archived: string[];
  roles: Array<{ id: string; name: string; color?: number }>;
  channels: Array<{ id: string; name: string }>;
  down: boolean;
} {
  let n = 0;
  const me = {
    roles: [] as Array<{ id: string; name: string; color?: number }>,
    channels: [] as Array<{ id: string; name: string }>,
    async listRoles() {
      return me.down ? null : me.roles.map((r) => ({ id: r.id, name: r.name }));
    },
    async createRole(_guildId: string, name: string, color: number) {
      if (me.down) return null;
      const id = `role_${(n += 1)}`;
      me.roles.push({ id, name, color });
      return id;
    },
    async listChannels() {
      return me.down ? null : me.channels.map((c) => ({ ...c }));
    },
    async createChannel(_guildId: string, name: string) {
      if (me.down) return null;
      const id = `chan_${(n += 1)}`;
      me.channels.push({ id, name });
      return id;
    },
    threads: [] as string[],
    privateThreads: [] as string[],
    threadMembers: [] as Array<{ thread: string; user: string }>,
    posts: [] as Array<{ channel: string; message: DiscordMessage; id: string }>,
    edits: [] as Array<{ channel: string; id: string; message: DiscordMessage }>,
    originals: [] as Array<{ token: string; message: DiscordMessage }>,
    pins: [] as string[],
    deleted: [] as string[],
    archived: [] as string[],
    down: false,
    async editOriginal(_applicationId: string, token: string, message: DiscordMessage) {
      if (me.down) return false;
      me.originals.push({ token, message });
      return true;
    },
    async createThread(_channelId: string, name: string, privately?: boolean) {
      if (me.down) return null;
      const id = `thread_${(n += 1)}`;
      me.threads.push(`${id} ${name}`);
      if (privately) me.privateThreads.push(id);
      return id;
    },
    async addThreadMember(thread: string, user: string) {
      if (me.down) return false;
      me.threadMembers.push({ thread, user });
      return true;
    },
    async postMessage(channel: string, message: DiscordMessage) {
      if (me.down) return null;
      const id = `msg_${(n += 1)}`;
      me.posts.push({ channel, message, id });
      return id;
    },
    async editMessage(channel: string, id: string, message: DiscordMessage) {
      if (me.down) return false;
      me.edits.push({ channel, id, message });
      return true;
    },
    async deleteMessage(_channel: string, id: string) {
      if (me.down) return false;
      me.deleted.push(id);
      return true;
    },
    async pinMessage(_channel: string, id: string) {
      if (me.down) return false;
      me.pins.push(id);
      return true;
    },
    async archiveThread(threadId: string) {
      if (me.down) return false;
      me.archived.push(threadId);
      return true;
    },
  };
  return me;
}

/** Discord's OAuth side, for a verification: one code is good, and what was written onto the person is kept. */
export function memoryOAuth(): DiscordOAuth & { pushed: Array<{ token: string; platformUsername: string; metadata: Record<string, string | number> }>; exchanged: Array<{ code: string; redirectUri: string }>; who: { id: string; name: string } } {
  const me = {
    pushed: [] as Array<{ token: string; platformUsername: string; metadata: Record<string, string | number> }>,
    exchanged: [] as Array<{ code: string; redirectUri: string }>,
    who: { id: "1001", name: "Mira" },
    async exchange(code: string, redirectUri: string) {
      me.exchanged.push({ code, redirectUri });
      return code === "good" ? `bearer-${code}` : null;
    },
    async me(token: string) {
      return token === "bearer-good" ? { ...me.who } : null;
    },
    async pushRoleConnection(token: string, connection: { platformUsername: string; metadata: Record<string, string | number> }) {
      if (token !== "bearer-good") return false;
      me.pushed.push({ token, ...connection });
      return true;
    },
  };
  return me;
}

/** Discord's rows, in Maps, with the same rules as the real one: a code is spent by being read, a link or a claim replaces on both sides, and a vault never hands its packs back. */
export function memoryGuilds(): GuildStore & { codes: Map<string, LinkCode>; claims: Map<string, ClaimCode>; links: Map<string, Connection>; guilds: Map<string, Guild>; vault: Map<string, { meta: GuildPackMeta; source: string }>; runs: Map<string, GuildRun> } {
  const runs = new Map<string, GuildRun>();
  const codes = new Map<string, LinkCode>();
  const verifying = new Map<string, VerifyState>();
  const claims = new Map<string, ClaimCode>();
  const links = new Map<string, Connection>();
  const owners = new Map<string, string>();
  const guilds = new Map<string, Guild>();
  const vault = new Map<string, { meta: GuildPackMeta; source: string }>();
  const packsOf = (guildId: string) => [...vault.entries()].filter(([k]) => k.startsWith(`${guildId}/`));
  const emptyVault = (guildId: string) => {
    const packs = packsOf(guildId);
    for (const [k] of packs) vault.delete(k);
    return packs.length;
  };
  const release = (guildId: string) => {
    if (!guilds.has(guildId)) return 0;
    let rows = emptyVault(guildId);
    for (const r of [...runs.values()]) {
      if (r.guildId !== guildId) continue;
      runs.delete(r.sessionId);
      rows += 3;
    }
    guilds.delete(guildId);
    return rows + 2;
  };
  return {
    codes,
    claims,
    links,
    guilds,
    vault,
    runs,
    async putGuildRun(run) {
      runs.set(run.sessionId, structuredClone(run));
    },
    async guildRun(sessionId) {
      const r = runs.get(sessionId);
      return r ? structuredClone(r) : null;
    },
    async guildRunByThread(threadId) {
      const r = [...runs.values()].find((x) => x.threadId === threadId);
      return r ? structuredClone(r) : null;
    },
    async putLinkCode(link) {
      codes.set(link.code, { ...link });
    },
    async putVerifyState(v) {
      verifying.set(v.state, { ...v });
    },
    async takeVerifyState(state, at) {
      const found = verifying.get(state);
      verifying.delete(state);
      if (!found || found.expiresAt < at) return null;
      return { ...found };
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
      const previous = guilds.get(g.guildId);
      if (previous && previous.ownerSub !== g.ownerSub) emptyVault(g.guildId);
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
      for (const field of ["hostRoleId", "channelId", "cardMode", "threadMode"] as const) {
        if (patch[field] === undefined) continue;
        if (patch[field] === null) delete g[field];
        else (g as unknown as Record<string, unknown>)[field] = patch[field];
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
    async guildPackMeta(guildId, packId) {
      const p = vault.get(`${guildId}/${packId}`);
      return p ? { ...p.meta } : null;
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
