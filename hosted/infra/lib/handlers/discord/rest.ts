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
  /** A public thread in a channel, named; the id of the thread, or null when Discord would not. */
  createThread(channelId: string, name: string): Promise<string | null>;
  /** Post into a channel or thread; the message id, or null. */
  postMessage(channelId: string, message: DiscordMessage): Promise<string | null>;
  editMessage(channelId: string, messageId: string, message: DiscordMessage): Promise<boolean>;
  pinMessage(channelId: string, messageId: string): Promise<boolean>;
  /** Close a thread once its run has ended; it stays readable. */
  archiveThread(threadId: string): Promise<boolean>;
  /** Fill in a reply the handler deferred: the interaction's own webhook, good for fifteen minutes, needs no bot token. */
  editOriginal(applicationId: string, interactionToken: string, message: DiscordMessage): Promise<boolean>;
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
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Discord's ChannelType.PublicThread. */
const PUBLIC_THREAD = 11;

export function discordRest(token: string, fetchImpl: typeof fetch = fetch, ropeMs: number = ROPE_MS): DiscordRest {
  const id = (out: Record<string, unknown> | null) => (out && typeof out["id"] === "string" ? out["id"] : null);
  return {
    async createThread(channelId, name) {
      return id(await call(token, "POST", `/channels/${channelId}/threads`, { name: name.slice(0, 100), type: PUBLIC_THREAD, auto_archive_duration: 1440 }, fetchImpl, ropeMs));
    },
    async postMessage(channelId, message) {
      return id(await call(token, "POST", `/channels/${channelId}/messages`, message, fetchImpl, ropeMs));
    },
    async editMessage(channelId, messageId, message) {
      return (await call(token, "PATCH", `/channels/${channelId}/messages/${messageId}`, message, fetchImpl, ropeMs)) !== null;
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
  };
}

/** A server's name, for the profile; best effort, since a claim must not wait on Discord. */
export async function guildNameFrom(token: string, guildId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!/^\d{15,22}$/.test(guildId)) return null;
  const out = await call(token, "GET", `/guilds/${guildId}`, undefined, fetchImpl, ROPE_MS);
  const name = out?.["name"];
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null;
}
