import type { PartyServer, PartyView } from "../sync/client.ts";

/**
 * What the people panel's Watch party button is at this moment.
 *
 * Its own function so the states can be read at a glance and tested
 * without a render: nothing, share the link first, open it in the one
 * server, pick among several, or here is the thread.
 */
export type WatchPartyState =
  | { kind: "hidden" }
  | { kind: "share-first" }
  | { kind: "one"; server: PartyServer }
  | { kind: "pick"; servers: PartyServer[] }
  | { kind: "open"; party: PartyView };

export function watchPartyState(input: { owner: boolean; shared: boolean; servers: PartyServer[]; parties: PartyView[] }): WatchPartyState {
  const open = input.parties.find((p) => !p.closedAt);
  // An open party shows whether or not the run is shared and whichever
  // server it is in: it was opened, and the thread is there to go to.
  if (open) return { kind: "open", party: open };
  if (!input.owner || input.servers.length === 0) return { kind: "hidden" };
  if (!input.shared) return { kind: "share-first" };
  return input.servers.length === 1 ? { kind: "one", server: input.servers[0]! } : { kind: "pick", servers: input.servers };
}
