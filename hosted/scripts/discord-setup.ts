import { COMMANDS, installLink, PERMISSION_NAMES } from "../infra/lib/handlers/discord/commands";
import { ROLE_CONNECTION_METADATA } from "../infra/lib/handlers/discord/linked-roles";

/**
 * The bot's commands, told to Discord, once per application.
 *
 * Run with the application's id and its bot token from your own terminal:
 *
 *   $env:DISCORD_APPLICATION_ID = "…"; $env:DISCORD_BOT_TOKEN = "…"; npx tsx hosted/scripts/discord-setup.ts
 *
 * Idempotent: Discord's bulk overwrite replaces the application's command
 * list with this one, so running it twice changes nothing and a command
 * removed from `commands.ts` disappears from every server. Registered for
 * every server the application is in, which Discord takes up to an hour
 * to show; with DISCORD_GUILD_ID set, registered for that one server
 * instead, at once, which is what a development server wants. The
 * commands themselves live beside the handler that answers them.
 */

const APPLICATION_ID = process.env["DISCORD_APPLICATION_ID"];
const TOKEN = process.env["DISCORD_BOT_TOKEN"];
const GUILD_ID = process.env["DISCORD_GUILD_ID"];

if (!APPLICATION_ID || !/^\d{15,22}$/.test(APPLICATION_ID)) {
  console.error("DISCORD_APPLICATION_ID is not set, or is not an application id");
  process.exit(1);
}
if (!TOKEN || !/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}$/.test(TOKEN)) {
  console.error("DISCORD_BOT_TOKEN is not set, or is not a bot token");
  process.exit(1);
}
if (GUILD_ID && !/^\d{15,22}$/.test(GUILD_ID)) {
  console.error("DISCORD_GUILD_ID is set but is not a server id");
  process.exit(1);
}

async function main() {
  const where = GUILD_ID ? `applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands` : `applications/${APPLICATION_ID}/commands`;
  const res = await fetch(`https://discord.com/api/v10/${where}`, {
    method: "PUT",
    headers: { authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(COMMANDS),
  });
  if (!res.ok) {
    console.error(`Discord answered ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const registered = (await res.json()) as Array<{ name: string; id: string }>;
  console.log(`${GUILD_ID ? `server ${GUILD_ID}` : "every server"}: ${registered.length} command(s)`);
  for (const c of registered) console.log(`  /${c.name}  ${c.id}`);
  // What a server's linked roles may read about a member: registered once
  // per application, from the same list the callback writes values for.
  const meta = await fetch(`https://discord.com/api/v10/applications/${APPLICATION_ID}/role-connections/metadata`, {
    method: "PUT",
    headers: { authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(ROLE_CONNECTION_METADATA),
  });
  if (!meta.ok) {
    console.error(`Discord answered ${meta.status} to the linked-role metadata: ${await meta.text()}`);
    process.exit(1);
  }
  console.log(`linked-role metadata: ${ROLE_CONNECTION_METADATA.map((m) => m.key).join(", ")}`);
  console.log(`\nInteractions endpoint: https://<domain>/api/discord/interactions`);
  console.log(`Linked Roles Verification URL: https://<domain>/api/discord/linked-role`);
  console.log(`OAuth2 redirect: https://<domain>/api/discord/linked-role/callback`);
  console.log(`Install link (${PERMISSION_NAMES.join(", ")}):\n${installLink(APPLICATION_ID)}`);
  console.log(`\nSee docs/discord-bot.md for the developer-portal settings around this.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
