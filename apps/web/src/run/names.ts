import type { SessionMember } from "../sync/client.ts";

/**
 * The account behind a connection, as the server names it.
 *
 * A tool dials on a watch key rather than signing in, so its connection
 * is named for the key's owner with a prefix. A deck signs in and is
 * named plainly. Stripping the prefix lets both be held against the
 * member list.
 */
export function accountOf(sub: string): string {
  return sub.startsWith("stream:") ? sub.slice("stream:".length) : sub;
}

/**
 * The display name for an account with a connection, from the member list.
 *
 * The people panel and the deck toast both turn an account id into a
 * name the same way: strip whatever prefix the connection's own sub
 * carries, and look the rest up among who is at the table. Undefined
 * where the account is not one of them, or is one with no name on file.
 */
export function nameOf(sub: string, members: SessionMember[]): string | undefined {
  return members.find((m) => m.sub === accountOf(sub))?.name;
}
