import type { Connection } from "../guilds.js";

/**
 * Linked roles: a server can make a role depend on what an application
 * says about a member, and this is what Runlog says. The keys are
 * registered once per application by the setup script; the values are
 * written onto a person's Discord connection when they verify (an OAuth
 * round trip, since only the person can grant that), and a server owner
 * then ties a role to them under Server Settings → Roles → Links.
 *
 * Discord's metadata types, by number: 5 is "date at most this many days
 * before now", 7 is "boolean equals".
 */
export const ROLE_CONNECTION_METADATA = [
  { key: "linked", name: "Runlog account linked", description: "Has linked a Runlog account to this Discord account", type: 7 },
  { key: "since", name: "Days since linking", description: "Linked a Runlog account at least this many days ago", type: 5 },
] as const;

/** What Runlog says about a linked person: yes, and since when. */
export function metadataFor(connection: Connection): Record<string, string | number> {
  return { linked: 1, since: connection.linkedAt };
}

/** How long a verification, once begun, may take before the state behind it is forgotten. */
export const VERIFY_MINUTES = 10;

/** Where Discord sends the person to grant the two scopes: to know who they are, and to write the connection. */
export function authorizeUrl(applicationId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: applicationId, redirect_uri: redirectUri, response_type: "code", scope: "identify role_connections.write", state, prompt: "consent" });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

/** The callback the authorization comes back to, on the app's own origin. */
export function verifyRedirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/discord/linked-role/callback`;
}
