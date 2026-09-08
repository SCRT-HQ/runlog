/**
 * The bot's commands, as Discord is told them.
 *
 * One list, read by two things: the handler, which answers them, and
 * `hosted/scripts/discord-setup.ts`, which registers them with Discord.
 * Defined here rather than in the script so the two cannot drift: a
 * command the script registers that the handler does not answer would
 * sit in every server's menu doing nothing.
 */

/** Discord's ApplicationCommandType.ChatInput: a slash command. */
const CHAT_INPUT = 1;
/** Discord's ApplicationCommandOptionType. */
const SUB_COMMAND = 1;
const CHANNEL = 7;
const ROLE = 8;
/** The permission a member needs to manage the server: MANAGE_GUILD, as a bitfield string, which is how Discord takes a default. */
const MANAGE_GUILD = String(1 << 5);

export const COMMANDS = [
  {
    name: "link",
    type: CHAT_INPUT,
    description: "Link this Discord account to your Runlog account",
  },
  {
    name: "setup",
    type: CHAT_INPUT,
    description: "Set up Runlog on this server",
    // Shown only to people who can manage the server; the handler checks again.
    default_member_permissions: MANAGE_GUILD,
    dm_permission: false,
    options: [
      { type: SUB_COMMAND, name: "claim", description: "Claim this server for your Runlog account, which pays for it and chooses its packs" },
      { type: SUB_COMMAND, name: "role", description: "Who may host runs here", options: [{ type: ROLE, name: "role", description: "The role that may host; leave it out to allow anyone who can manage the server", required: false }] },
      { type: SUB_COMMAND, name: "channel", description: "Where runs open by default", options: [{ type: CHANNEL, name: "channel", description: "The channel; leave it out to open runs wherever the command is used", required: false }] },
      { type: SUB_COMMAND, name: "status", description: "Who claimed this server, its plan, its hosts and its packs" },
    ],
  },
  {
    name: "packs",
    type: CHAT_INPUT,
    description: "The packs the bot can play on this server",
    dm_permission: false,
  },
] as const;

export type CommandName = (typeof COMMANDS)[number]["name"];

const NAMES = new Set<string>(COMMANDS.map((c) => c.name));

export function isCommandName(name: unknown): name is CommandName {
  return typeof name === "string" && NAMES.has(name);
}
