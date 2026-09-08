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

export const COMMANDS = [
  {
    name: "link",
    type: CHAT_INPUT,
    description: "Link this Discord account to your Runlog account",
  },
] as const;

export type CommandName = (typeof COMMANDS)[number]["name"];

const NAMES = new Set<string>(COMMANDS.map((c) => c.name));

export function isCommandName(name: unknown): name is CommandName {
  return typeof name === "string" && NAMES.has(name);
}
