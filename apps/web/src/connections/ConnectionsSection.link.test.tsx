// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api } from "../sync/client.ts";
import { ConnectionsSection } from "./ConnectionsSection.tsx";

/**
 * The section as it is pressed: a code handed in, and what the row shows
 * once it is bound. A person who came from a server's linked role, linked
 * with a code, and then looked for the way to verify has to find it
 * right there, not after a reload.
 */
const signedIn: Account = {
  status: "signed-in",
  user: { id: "u1", email: "mira@example.com" } as Account extends { user: infer U } ? U : never,
  signOut: () => {},
  getAccessToken: async () => "t",
} as Account;

afterEach(cleanup);

const connections = [
  { service: "discord" as const, accountId: "1001", name: "scrthq", linkedAt: "2026-09-09T00:00:00Z" },
  { service: "discord" as const, accountId: "1002", name: "runlog-mod", linkedAt: "2026-09-10T00:00:00Z" },
];

function renderConnections({
  linked = connections,
  verify = true,
  unlinkDiscord = async () => {},
}: {
  linked?: typeof connections;
  verify?: boolean;
  unlinkDiscord?: (accountId: string) => Promise<void>;
} = {}) {
  const api = {
    connections: async () => ({ available: true, connections: linked, discord: null, verify }),
    unlinkDiscord,
  } as unknown as Api;
  return render(
    <AccountContext.Provider value={signedIn}>
      <ConnectionsSection api={api} pending={null} />
    </AccountContext.Provider>,
  );
}

describe("linking with a code", () => {
  it("keeps offering to verify for linked roles once the code is bound, where the bot's OAuth side is set up", async () => {
    const api = {
      connections: async () => ({ available: true, connections: [], discord: null, verify: true }),
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
    expect(screen.queryByText(/link another/)).toBeNull();
  });
});

describe("linked account actions", () => {
  it.each([
    ["one", connections.slice(0, 1)],
    ["multiple", connections],
  ])("shows %s linked account without inventing a Discord link-another account", async (_count, linked) => {
    renderConnections({ linked });

    await screen.findByText(new RegExp(`linked as ${linked[0]!.name}`));
    expect(screen.queryByText(/link another/)).toBeNull();
    expect(screen.getByText(/run \/link and open the address/)).toBeTruthy();
  });

  it("keeps useful Discord not-linked guidance when the account list is empty", async () => {
    renderConnections({ linked: [], verify: false });

    expect(await screen.findByText(/not linked/)).toBeTruthy();
    expect(screen.getByText(/run \/link and open the address/)).toBeTruthy();
  });

  it("keeps the linking instructions without offering verification when OAuth verification is unavailable", async () => {
    renderConnections({ linked: connections.slice(0, 1), verify: false });

    await screen.findByText(/linked as scrthq/);
    expect(screen.getByText(/run \/link and open the address/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verify for linked roles/i })).toBeNull();
  });

  it.each([
    ["done" as const, /Verified\./],
    ["failed" as const, /did not finish/],
  ])("dismisses a %s verification result from its OK action", (result, message) => {
    const api = { connections: async () => ({ available: true, connections: [], discord: null }) } as unknown as Api;
    render(
      <AccountContext.Provider value={signedIn}>
        <ConnectionsSection api={api} pending={{ kind: "verify", result }} />
      </AccountContext.Provider>,
    );

    expect(screen.getByRole("status").textContent).toMatch(message);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(message)).toBeNull();
  });

  it("unlinks the Discord account named by the row action", async () => {
    const unlinkDiscord = vi.fn(async () => {});
    renderConnections({ unlinkDiscord });
    const target = await screen.findByText(/linked as runlog-mod/);
    const row = target.closest(".connectionsRow");

    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(unlinkDiscord).toHaveBeenCalledWith("1002"));
    await waitFor(() => expect(screen.queryByText(/linked as runlog-mod/)).toBeNull());
    expect(screen.getByText(/linked as scrthq/)).toBeTruthy();
  });
});
