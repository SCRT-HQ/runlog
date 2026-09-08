/**
 * The little of Discord's interaction shapes the handler reads and writes.
 *
 * No client library: an interaction is JSON in, JSON out, and the fields
 * used here are a dozen. Kept to what is read, so a field Discord adds
 * changes nothing, and a field it renames fails a test rather than a
 * server.
 */

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  Autocomplete: 4,
  ModalSubmit: 5,
} as const;

export const ResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  AutocompleteResult: 8,
  Modal: 9,
} as const;

/** A message only the person who pressed sees. */
export const EPHEMERAL = 1 << 6;

export interface DiscordUser {
  id: string;
  username: string;
  /** The display name, where the person set one. */
  global_name?: string | null;
}

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
  focused?: boolean;
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  /** In a server: the member, with the user inside and their permissions as a bitfield string. */
  member?: { user: DiscordUser; permissions?: string; roles?: string[]; nick?: string | null };
  /** In a direct message: the user alone. */
  user?: DiscordUser;
  data?: {
    id?: string;
    name?: string;
    type?: number;
    options?: CommandOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
  };
}

export interface InteractionResponse {
  type: number;
  data?: {
    content?: string;
    flags?: number;
    embeds?: unknown[];
    components?: unknown[];
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a body has the shape of an interaction: the fields every one carries. */
export function isInteraction(v: unknown): v is Interaction {
  return isRecord(v) && typeof v["id"] === "string" && typeof v["application_id"] === "string" && typeof v["type"] === "number" && typeof v["token"] === "string";
}

/** Who pressed: the member's user in a server, the user alone in a direct message. */
export function userOf(i: Interaction): DiscordUser | null {
  return i.member?.user ?? i.user ?? null;
}

/** The name to show for a Discord user: what they chose, else their handle. */
export function nameOf(u: DiscordUser): string {
  return (u.global_name && u.global_name.trim()) || u.username;
}
