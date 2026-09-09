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
const STRING = 3;
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
  {
    name: "run",
    type: CHAT_INPUT,
    description: "A run the bot hosts here",
    dm_permission: false,
    options: [
      {
        type: SUB_COMMAND,
        name: "start",
        description: "Start a run in a thread, on one of this server's packs",
        options: [
          { type: STRING, name: "pack", description: "Which pack", required: true, autocomplete: true },
          { type: STRING, name: "mode", description: "Which of its modes", required: true, autocomplete: true },
          { type: STRING, name: "name", description: "What to call the run", required: false, max_length: 80 },
        ],
      },
      { type: SUB_COMMAND, name: "status", description: "Post the table card again, in this run's thread" },
      { type: SUB_COMMAND, name: "link", description: "The live link: anyone watches, no account needed" },
      { type: SUB_COMMAND, name: "end", description: "End the run", options: [{ type: STRING, name: "ending", description: "How it ends, where the pack offers a choice", required: false, autocomplete: true }] },
    ],
  },
] as const;

export type CommandName = (typeof COMMANDS)[number]["name"];

const NAMES = new Set<string>(COMMANDS.map((c) => c.name));

export function isCommandName(name: unknown): name is CommandName {
  return typeof name === "string" && NAMES.has(name);
}

/**
 * What the bot needs in a server, as Discord's permission bits: to see
 * channels, to post in them and in threads, to open a public thread per
 * run and close it after, to post embeds, to read what it posted, and to
 * pin the table card. Nothing that reads members' messages beyond the
 * thread it hosts, and nothing that manages people.
 */
const PERMISSION_BITS = {
  VIEW_CHANNEL: 10n,
  SEND_MESSAGES: 11n,
  MANAGE_MESSAGES: 13n,
  EMBED_LINKS: 14n,
  READ_MESSAGE_HISTORY: 16n,
  MANAGE_THREADS: 34n,
  CREATE_PUBLIC_THREADS: 35n,
  SEND_MESSAGES_IN_THREADS: 38n,
} as const;

export const PERMISSION_NAMES = ["View Channels", "Send Messages", "Manage Messages", "Embed Links", "Read Message History", "Manage Threads", "Create Public Threads", "Send Messages in Threads"] as const;

export const PERMISSIONS = String(Object.values(PERMISSION_BITS).reduce((sum, bit) => sum | (1n << bit), 0n));

export const installLink = (applicationId: string) => `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot+applications.commands&permissions=${PERMISSIONS}`;
