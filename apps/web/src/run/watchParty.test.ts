import { describe, expect, it } from "vitest";
import { watchPartyState } from "./watchParty.ts";
import type { PartyServer, PartyView } from "../sync/client.ts";

const server = (guildId: string, name?: string): PartyServer => ({ guildId, ...(name ? { name } : {}), watchParties: "off" });
const party = (guildId: string): PartyView => ({
  guildId,
  threadId: "t1",
  threadUrl: `https://discord.com/channels/${guildId}/t1`,
  openedAt: "2026-09-16T10:00:00.000Z",
});

describe("what the watch party button offers", () => {
  it("is not there for somebody who is not the owner, or with no server claimed", () => {
    expect(watchPartyState({ owner: false, shared: true, servers: [server("g1")], parties: [] })).toEqual({ kind: "hidden" });
    expect(watchPartyState({ owner: true, shared: true, servers: [], parties: [] })).toEqual({ kind: "hidden" });
  });

  it("asks for the link first where the run is not shared", () => {
    expect(watchPartyState({ owner: true, shared: false, servers: [server("g1")], parties: [] })).toEqual({ kind: "share-first" });
  });

  it("opens straight into the one server, and offers a pick where there are several", () => {
    expect(watchPartyState({ owner: true, shared: true, servers: [server("g1", "The Kiln Room")], parties: [] })).toEqual({
      kind: "one",
      server: server("g1", "The Kiln Room"),
    });
    const two = [server("g1", "The Kiln Room"), server("g2", "The Back Room")];
    expect(watchPartyState({ owner: true, shared: true, servers: two, parties: [] })).toEqual({ kind: "pick", servers: two });
  });

  it("shows the thread once a party is open, whichever way it was opened", () => {
    expect(watchPartyState({ owner: true, shared: true, servers: [server("g1")], parties: [party("g1")] })).toEqual({
      kind: "open",
      party: party("g1"),
    });
    // A party in a server this account no longer lists still shows: it is open.
    expect(watchPartyState({ owner: true, shared: true, servers: [server("g2")], parties: [party("g1")] })).toEqual({
      kind: "open",
      party: party("g1"),
    });
  });
});
