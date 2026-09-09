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
  /** The message a component was pressed on. */
  message?: { id: string };
  data?: {
    id?: string;
    name?: string;
    type?: number;
    options?: CommandOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
    /** A modal's rows, each holding one input with its value. */
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>;
  };
}

export interface InteractionResponse {
  type: number;
  data?: {
    content?: string;
    flags?: number;
    embeds?: unknown[];
    components?: unknown[];
    /** A modal's id and title, with `components` its inputs. */
    custom_id?: string;
    title?: string;
    /** Autocomplete's answers. */
    choices?: Array<{ name: string; value: string }>;
  };
}

// ---- building blocks for what the bot posts ----

/** Discord's ComponentType and ButtonStyle, the few used. */
export const Component = { ActionRow: 1, Button: 2, StringSelect: 3, TextInput: 4 } as const;
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4 } as const;

export interface Button {
  type: typeof Component.Button;
  style: number;
  custom_id: string;
  label: string;
  disabled?: boolean;
}

export const button = (customId: string, label: string, style: number = ButtonStyle.Secondary, disabled = false): Button => ({
  type: Component.Button,
  style,
  custom_id: customId.slice(0, 100),
  label: label.slice(0, 80),
  ...(disabled ? { disabled: true } : {}),
});

export const row = (...components: unknown[]) => ({ type: Component.ActionRow, components: components.slice(0, 5) });

export const select = (customId: string, placeholder: string, options: Array<{ label: string; value: string; description?: string }>) => ({
  type: Component.ActionRow,
  components: [
    {
      type: Component.StringSelect,
      custom_id: customId.slice(0, 100),
      placeholder: placeholder.slice(0, 150),
      options: options.slice(0, 25).map((o) => ({ label: o.label.slice(0, 100), value: o.value.slice(0, 100), ...(o.description ? { description: o.description.slice(0, 100) } : {}) })),
    },
  ],
});

/** A modal with one text input; the answer comes back as a ModalSubmit with the input's value. */
export const modal = (customId: string, title: string, input: { id: string; label: string; placeholder?: string; value?: string; paragraph?: boolean }): InteractionResponse => ({
  type: ResponseType.Modal,
  data: {
    custom_id: customId.slice(0, 100),
    title: title.slice(0, 45),
    components: [
      {
        type: Component.ActionRow,
        components: [
          {
            type: Component.TextInput,
            custom_id: input.id.slice(0, 100),
            style: input.paragraph ? 2 : 1,
            label: input.label.slice(0, 45),
            required: true,
            max_length: 200,
            ...(input.placeholder ? { placeholder: input.placeholder.slice(0, 100) } : {}),
            ...(input.value ? { value: input.value.slice(0, 200) } : {}),
          },
        ],
      },
    ],
  },
});

export interface Embed {
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  color?: number;
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
