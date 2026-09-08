/**
 * The little the API asks Discord itself.
 *
 * Interactions arrive by HTTP and are answered in the same turn, so the
 * bot rarely needs to call Discord back. What it asks so far is a
 * server's name, for the profile's list of servers, since an interaction
 * carries a server's id and not what it is called. Best effort, with a
 * short rope: a name is a nicety, and a claim must not wait on Discord.
 */

const API = "https://discord.com/api/v10";
const ROPE_MS = 2000;

export async function guildNameFrom(token: string, guildId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!/^\d{15,22}$/.test(guildId)) return null;
  const rope = new AbortController();
  const timer = setTimeout(() => rope.abort(), ROPE_MS);
  try {
    const res = await fetchImpl(`${API}/guilds/${guildId}`, { headers: { authorization: `Bot ${token}` }, signal: rope.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
