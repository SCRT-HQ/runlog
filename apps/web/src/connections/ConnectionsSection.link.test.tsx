// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api } from "../sync/client.ts";
import { ConnectionsSection } from "./ConnectionsSection.tsx";

/**
 * The section as it is pressed: a code handed in, and what the row shows
 * once it is bound. A person who came from a server's linked role, linked
 * with a code, and then looked for the way to verify has to find it
 * right there, not after a reload.
 */
const signedIn: Account = { status: "signed-in", user: { id: "u1", email: "mira@example.com" } as Account extends { user: infer U } ? U : never, signOut: () => {}, getAccessToken: async () => "t" } as Account;

afterEach(cleanup);

describe("linking with a code", () => {
  it("keeps offering to verify for linked roles once the code is bound, where the bot's OAuth side is set up", async () => {
    const api = {
      connections: async () => ({ available: true, discord: null, verify: true }),
      linkDiscord: async () => ({ discordUserId: "1001", name: "scrthq", linkedAt: "2026-09-09T00:00:00Z" }),
    } as unknown as Api;
    render(
      <AccountContext.Provider value={signedIn}>
        <ConnectionsSection api={api} pending={{ kind: "discord", code: "ABCDEF" }} />
      </AccountContext.Provider>,
    );
    await screen.findByText("Link to this account");
    fireEvent.click(screen.getByText("Link to this account"));
    await waitFor(() => expect(screen.getByText(/linked as scrthq/)).toBeTruthy());
    expect(screen.getByText("Verify for linked roles")).toBeTruthy();
    expect(screen.getByText(/press Verify for linked roles/)).toBeTruthy();
  });
});
