/**
 * The little the API asks Discord itself.
 *
 * Interactions arrive by HTTP and are answered in the same turn, so the
 * bot calls Discord back only for what an answer cannot carry: a thread
 * for a run to live in, the messages posted into it, a pin, and a
 * server's name for the profile. Every call has a short rope — Discord
 * waits three seconds for the interaction's answer, and a slow post must
 * not spend them — and a failure is reported to the caller rather than
 * thrown through it, since the run's log is already written and the card
 * is rebuilt from it on the next press.
 */

const API = "https://discord.com/api/v10";
/** How long a call may take: short on the route, which has three seconds in all; longer on the job, which has thirty. */
export const ROPE_MS = 2000;
export const PATIENT_ROPE_MS = 8000;

export interface DiscordMessage {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

export interface DiscordRest {
  /**
   * A thread in a channel, named; the id of the thread, or null when
   * Discord would not. Public by default, so anyone who can see the
   * channel can open it; private on request, which takes Create Private
   * Threads and starts with nobody in it but the bot.
   */
  createThread(channelId: string, name: string, privately?: boolean): Promise<string | null>;
  /** Put somebody in a thread: how the host is let into the private one their run opened in. */
  addThreadMember(threadId: string, userId: string): Promise<boolean>;
  /** Post into a channel or thread; the message id, or null. */
  postMessage(channelId: string, message: DiscordMessage): Promise<string | null>;
  editMessage(channelId: string, messageId: string, message: DiscordMessage): Promise<boolean>;
  /** Take a message of the bot's own down: a retired card that carried nothing else. */
  deleteMessage(channelId: string, messageId: string): Promise<boolean>;
  pinMessage(channelId: string, messageId: string): Promise<boolean>;
  /** Close a thread once its run has ended; it stays readable. */
  archiveThread(threadId: string): Promise<boolean>;
  /** Fill in a reply the handler deferred: the interaction's own webhook, good for fifteen minutes, needs no bot token. */
  editOriginal(applicationId: string, interactionToken: string, message: DiscordMessage): Promise<boolean>;
  /** The server's roles, by id and name; null when Discord would not say. */
  listRoles(guildId: string): Promise<Array<{ id: string; name: string }> | null>;
  /** A role with no permissions of its own, in a color; its id, or null. */
  createRole(guildId: string, name: string, color: number): Promise<string | null>;
  /** The server's text channels, by id and name; null when Discord would not say. */
  listChannels(guildId: string): Promise<Array<{ id: string; name: string }> | null>;
  /** A text channel at the top level; its id, or null. */
  createChannel(guildId: string, name: string): Promise<string | null>;
}

async function call(token: string, method: string, path: string, body: unknown, fetchImpl: typeof fetch, ropeMs: number): Promise<Record<string, unknown> | null> {
  const rope = new AbortController();
  const timer = setTimeout(() => rope.abort(), ropeMs);
  try {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: rope.signal,
    });
    if (!res.ok) return null;
    if (res.status === 204) return {};
    const parsed: unknown = await res.json();
    if (Array.isArray(parsed)) return { items: parsed };
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Discord's ChannelType.PublicThread and ChannelType.PrivateThread. */
const PUBLIC_THREAD = 11;
const PRIVATE_THREAD = 12;

export function discordRest(token: string, fetchImpl: typeof fetch = fetch, ropeMs: number = ROPE_MS): DiscordRest {
  const id = (out: Record<string, unknown> | null) => (out && typeof out["id"] === "string" ? out["id"] : null);
  return {
    async createThread(channelId, name, privately) {
      // `invitable` lets the host add whoever else the run is for without
      // asking the bot to; Discord takes it on a private thread alone.
      const kind = privately ? { type: PRIVATE_THREAD, invitable: true } : { type: PUBLIC_THREAD };
      return id(await call(token, "POST", `/channels/${channelId}/threads`, { name: name.slice(0, 100), ...kind, auto_archive_duration: 1440 }, fetchImpl, ropeMs));
    },
    async addThreadMember(threadId, userId) {
      // Discord answers 204 with no body, which `call` reads as an empty object rather than a failure.
      return (await call(token, "PUT", `/channels/${threadId}/thread-members/${userId}`, undefined, fetchImpl, ropeMs)) !== null;
    },
    async postMessage(channelId, message) {
      return id(await call(token, "POST", `/channels/${channelId}/messages`, message, fetchImpl, ropeMs));
    },
    async editMessage(channelId, messageId, message) {
      return (await call(token, "PATCH", `/channels/${channelId}/messages/${messageId}`, message, fetchImpl, ropeMs)) !== null;
    },
    async deleteMessage(channelId, messageId) {
      return (await call(token, "DELETE", `/channels/${channelId}/messages/${messageId}`, undefined, fetchImpl, ropeMs)) !== null;
    },
    async pinMessage(channelId, messageId) {
      return (await call(token, "PUT", `/channels/${channelId}/pins/${messageId}`, undefined, fetchImpl, ropeMs)) !== null;
    },
    async archiveThread(threadId) {
      return (await call(token, "PATCH", `/channels/${threadId}`, { archived: true }, fetchImpl, ropeMs)) !== null;
    },
    async editOriginal(applicationId, interactionToken, message) {
      return (await call(token, "PATCH", `/webhooks/${applicationId}/${interactionToken}/messages/@original`, message, fetchImpl, ropeMs)) !== null;
    },
    async listRoles(guildId) {
      return named(await call(token, "GET", `/guilds/${guildId}/roles`, undefined, fetchImpl, ropeMs));
    },
    async createRole(guildId, name, color) {
      return id(await call(token, "POST", `/guilds/${guildId}/roles`, { name: name.slice(0, 100), permissions: "0", color, hoist: false, mentionable: true }, fetchImpl, ropeMs));
    },
    async listChannels(guildId) {
      const rows = named(await call(token, "GET", `/guilds/${guildId}/channels`, undefined, fetchImpl, ropeMs), (row) => row["type"] === 0);
      return rows;
    },
    async createChannel(guildId, name) {
      return id(await call(token, "POST", `/guilds/${guildId}/channels`, { name: name.slice(0, 100), type: 0 }, fetchImpl, ropeMs));
    },
  };
}

/** A list Discord answered, kept to the rows with an id and a name, and to those a filter keeps. */
function named(out: Record<string, unknown> | null, keep: (row: Record<string, unknown>) => boolean = () => true): Array<{ id: string; name: string }> | null {
  const rows = out?.["items"];
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && keep(row as Record<string, unknown>))
    .flatMap((row) => (typeof row["id"] === "string" && typeof row["name"] === "string" ? [{ id: row["id"], name: row["name"] }] : []));
}

/** A server's name, for the profile; best effort, since a claim must not wait on Discord. */
/**
 * The three calls a linked-role verification makes on a person's behalf,
 * with the token their consent minted rather than the bot's: trade the
 * code for the token, ask who they are, and write Runlog's word about
 * them onto their connection. See linked-roles.ts for what is written.
 */
export interface DiscordOAuth {
  exchange(code: string, redirectUri: string): Promise<string | null>;
  me(accessToken: string): Promise<{ id: string; name: string } | null>;
  pushRoleConnection(accessToken: string, connection: { platformUsername: string; metadata: Record<string, string | number> }): Promise<boolean>;
}

export function discordOAuth(applicationId: string, clientSecret: string, fetchImpl: typeof fetch = fetch, ropeMs: number = PATIENT_ROPE_MS): DiscordOAuth {
  const bearer = async (method: string, path: string, token: string, body?: unknown): Promise<Record<string, unknown> | null> => {
    const rope = new AbortController();
    const timer = setTimeout(() => rope.abort(), ropeMs);
    try {
      const res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: rope.signal,
      });
      if (!res.ok) return null;
      if (res.status === 204) return {};
      const parsed: unknown = await res.json();
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async exchange(code, redirectUri) {
      const rope = new AbortController();
      const timer = setTimeout(() => rope.abort(), ropeMs);
      try {
        const res = await fetchImpl(`${API}/oauth2/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: applicationId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
          signal: rope.signal,
        });
        if (!res.ok) return null;
        const parsed = (await res.json()) as { access_token?: unknown };
        return typeof parsed.access_token === "string" && parsed.access_token ? parsed.access_token : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    async me(accessToken) {
      const out = await bearer("GET", "/users/@me", accessToken);
      const id = out?.["id"];
      if (typeof id !== "string" || !/^\d{15,22}$/.test(id)) return null;
      const global = out?.["global_name"];
      const username = out?.["username"];
      const name = (typeof global === "string" && global.trim()) || (typeof username === "string" && username.trim()) || id;
      return { id, name: name.slice(0, 100) };
    },
    async pushRoleConnection(accessToken, connection) {
      return (await bearer("PUT", `/users/@me/applications/${applicationId}/role-connection`, accessToken, { platform_name: "Runlog", platform_username: connection.platformUsername.slice(0, 100), metadata: connection.metadata })) !== null;
    },
  };
}

/**
 * Whether a server holds a live entitlement to a SKU sold through Discord's
 * own store: one that is not deleted and has not ended. A subscription
 * that lapsed keeps its entitlement row with an `ends_at` in the past;
 * Discord can also be asked to leave ended ones out, and is.
 */
export async function guildEntitledFrom(token: string, applicationId: string, guildId: string, skuId: string, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<boolean> {
  if (!/^\d{15,22}$/.test(guildId) || !/^\d{15,22}$/.test(skuId)) return false;
  const out = await call(token, "GET", `/applications/${applicationId}/entitlements?guild_id=${guildId}&sku_ids=${skuId}&exclude_ended=true`, undefined, fetchImpl, ROPE_MS);
  const rows: unknown = out && Array.isArray(out["items"]) ? out["items"] : out;
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    if (r["deleted"] === true || r["sku_id"] !== skuId) return false;
    const ends = typeof r["ends_at"] === "string" ? Date.parse(r["ends_at"]) : null;
    return ends === null || Number.isNaN(ends) || ends > nowMs;
  });
}

export async function guildNameFrom(token: string, guildId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!/^\d{15,22}$/.test(guildId)) return null;
  const out = await call(token, "GET", `/guilds/${guildId}`, undefined, fetchImpl, ROPE_MS);
  const name = out?.["name"];
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null;
}
