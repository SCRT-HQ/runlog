// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Hosted } from "../hosted/config.ts";
import type { Api, Guild } from "../sync/client.ts";
import type { StoredPack } from "../storage/db.ts";
import type { Plan, PlanAccess } from "../sync/usePlan.ts";
import { ServersPage } from "./ServersPage.tsx";

/**
 * The watch party setting as it is pressed: what the server already holds
 * shows on the way in, and one change saves it, with no second press to
 * confirm.
 */
vi.mock("../storage/db.ts", () => ({
  listPacks: async () => [
    { id: "com.example.kiln", title: "The Long Kiln", version: "1", format: "yaml", source: "" },
    { id: "com.example.other", title: "Wheel and Wire", version: "1", format: "yaml", source: "" },
  ],
}));
const planResult = vi.hoisted(() => ({ value: null as Plan | null }));
const hostedResult = vi.hoisted(() => ({ value: null as Hosted | null }));
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => planResult.value }));
vi.mock("../hosted/HostedProvider.tsx", () => ({ useHosted: () => hostedResult.value }));

const planWith = (answer: PlanAccess, serversOpen = true): Plan => ({
  state:
    answer === "available" || answer === "upgrade"
      ? {
          kind: "ready",
          ownerId: "user_ME",
          gates: true,
          capabilities: { hostTables: false, waivePublisherFee: false, hostServers: answer === "available" },
          offers: { servers: true, serversOpen, publishersOpen: true },
        }
      : answer === "error"
        ? { kind: "error", ownerId: "user_ME", message: "offline" }
        : { kind: "loading", ownerId: "user_ME" },
  access: () => answer,
  refresh: vi.fn(async () => {}),
});

const signedIn: Account = {
  status: "signed-in",
  user: { id: "user_ME", email: "n@example.com" } as Account extends { user: infer U } ? U : never,
  signOut: () => {},
  getAccessToken: async () => "token",
} as Account;

const guildOf = (over: Partial<Guild> = {}): Guild => ({
  guildId: "g1",
  name: "The Kiln Room",
  ownerSub: "user_ME",
  claimedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const noop = () => {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** The page with one claimed server, and the calls the setting makes recorded. */
function show(guild: Guild, setWatchParties: Api["setWatchParties"], shelf?: StoredPack[]) {
  const api = {
    myGuilds: async () => ({ guilds: [guild], server: true, open: false, allowed: 3 }),
    guildPacks: async () => [],
    setWatchParties,
  } as unknown as Api;
  render(
    <AccountContext.Provider value={signedIn}>
      <ServersPage api={api} availability="available" onRetryPlan={noop} {...(shelf ? { shelf } : {})} />
    </AccountContext.Provider>,
  );
}

const asked: Array<[string, string, string[] | undefined]> = [];
const saves =
  (answer: (g: Partial<Guild>) => Guild | Promise<Guild>): Api["setWatchParties"] =>
  async (guildId, mode, packIds) => {
    asked.push([guildId, mode, packIds]);
    return answer({ watchParties: mode === "off" ? undefined : mode, ...(packIds ? { watchPackIds: packIds } : {}) });
  };

afterEach(() => {
  cleanup();
  asked.length = 0;
  planResult.value = planWith("available");
  hostedResult.value = null;
  sessionStorage.clear();
});

planResult.value = planWith("available");

describe("server plan access", () => {
  const service = (checkout = vi.fn(async () => ({ available: false as const }))): Api =>
    ({
      myGuilds: async () => ({ guilds: [], server: false, open: true, allowed: 3 }),
      checkout,
    }) as unknown as Api;

  it.each([
    ["checking" as const, /Checking your plan/],
    ["error" as const, /plan could not be checked/],
  ])("does not expose checkout while access is %s", async (answer, message) => {
    const checkout = vi.fn(async () => ({ available: false as const }));
    planResult.value = planWith(answer);
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={service(checkout)} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Servers, \$9 a month/ })).toBeNull();
    expect(checkout).not.toHaveBeenCalled();
  });

  it("retries a failed plan check from the Servers page", async () => {
    const refresh = vi.fn(async () => {});
    planResult.value = { ...planWith("error"), refresh };
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={service()} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not call ungated effective access an active server subscription", async () => {
    hostedResult.value = {
      operator: "Example",
      support: "support@example.test",
      termsVersion: "v1",
      links: { terms: "https://example.test/terms", privacy: "https://example.test/privacy" },
      features: { billing: true, testing: false },
    };
    planResult.value = {
      state: {
        kind: "ready",
        ownerId: "user_ME",
        gates: false,
        capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
        offers: { servers: true, serversOpen: true, publishersOpen: true },
      },
      access: () => "available",
      refresh: async () => {},
    };
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={service()} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByRole("heading", { name: "Plan: available in preview" })).toBeTruthy();
    expect(screen.queryByText(/subscription is managed/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Servers, $9 a month" })).toBeNull();
  });

  it("offers checkout only when hosting is unavailable and the ready offer is open", async () => {
    planResult.value = planWith("upgrade", true);
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={service()} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );
    expect(await screen.findByRole("button", { name: "Servers, $9 a month" })).toBeTruthy();

    cleanup();
    planResult.value = planWith("available", true);
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={service()} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );
    await screen.findByText(/Runlog for servers, active/);
    expect(screen.queryByRole("button", { name: "Servers, $9 a month" })).toBeNull();
  });

  it("does not call myGuilds or expose checkout before deployment availability is confirmed", async () => {
    const myGuilds = vi.fn(async () => ({ guilds: [], server: false, open: true, allowed: 3 }));
    planResult.value = planWith("checking");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds } as unknown as Api} availability="checking" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText("Checking server availability…")).toBeTruthy();
    expect(myGuilds).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Servers, \$9 a month/ })).toBeNull();
  });

  it("shows an explicit failure and retries through onRetryPlan when the deployment's own availability check failed", async () => {
    const onRetryPlan = vi.fn();
    const myGuilds = vi.fn(async () => ({ guilds: [], server: false, open: true, allowed: 3 }));
    planResult.value = planWith("error");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds } as unknown as Api} availability="error" onRetryPlan={onRetryPlan} />
      </AccountContext.Provider>,
    );

    expect(screen.getByText("Server availability could not be checked.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryPlan).toHaveBeenCalledOnce();
    expect(myGuilds).not.toHaveBeenCalled();
  });
});

describe("the server list itself", () => {
  it("shows an explicit error and Retry when the server list fails, without fabricating an empty list or a false active plan", async () => {
    const myGuilds = vi.fn().mockRejectedValueOnce(new Error("guilds offline")).mockResolvedValueOnce({
      guilds: [],
      server: false,
      open: true,
      allowed: 3,
    });
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds, guildPacks: async () => [] } as unknown as Api} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    expect(screen.queryByText("No servers yet")).toBeNull();
    expect(screen.queryByText(/active/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(myGuilds).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No servers yet")).toBeTruthy();
  });

  it("says a guild's hosting is active through Discord when the account itself lacks the capability", async () => {
    planResult.value = planWith("upgrade");
    const guild = guildOf({ discord: true });
    const myGuilds = vi.fn(async () => ({ guilds: [guild], server: false, open: true, allowed: 3 }));
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds, guildPacks: async () => [] } as unknown as Api} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/active through Discord/)).toBeTruthy();
  });

  it("says a guild needs Runlog for servers when neither the account nor Discord hosts it, and keeps management controls", async () => {
    planResult.value = planWith("upgrade");
    const guild = guildOf();
    const myGuilds = vi.fn(async () => ({ guilds: [guild], server: false, open: true, allowed: 3 }));
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds, guildPacks: async () => [] } as unknown as Api} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/needs Runlog for servers/)).toBeTruthy();
    expect(screen.getByLabelText("Watch parties")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release" })).toBeTruthy();
    expect(screen.getByLabelText(`A pack to add to ${guild.name}`)).toBeTruthy();
  });

  it("keeps management available when serversOpen is false, with coming-soon copy scoped to the plan section", async () => {
    planResult.value = planWith("upgrade", false);
    const guild = guildOf();
    const myGuilds = vi.fn(async () => ({ guilds: [guild], server: false, open: false, allowed: 3 }));
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds, guildPacks: async () => [] } as unknown as Api} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByRole("button", { name: "Coming soon" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release" })).toBeTruthy();
  });

  it("refetches rather than fabricating a list when a claim succeeds while the list is in error", async () => {
    const claimed = guildOf({ guildId: "g9", name: "New Room" });
    const myGuilds = vi
      .fn()
      .mockRejectedValueOnce(new Error("guilds offline"))
      .mockResolvedValueOnce({ guilds: [claimed], server: false, open: true, allowed: 7 });
    const claimGuild = vi.fn(async () => ({ guild: claimed, upgrade: false }));
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage
          api={{ myGuilds, claimGuild, guildPacks: async () => [] } as unknown as Api}
          availability="available"
          onRetryPlan={noop}
          pending={{ kind: "guild", code: "CODE1" }}
        />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claim it for this account" }));
    await waitFor(() => expect(myGuilds).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("New Room")).toBeTruthy();
    // The real, refetched allowed count (7), never the fabrication's made-up 3.
    expect(screen.getByText(/up to 7 servers/)).toBeTruthy();
  });

  it("stays in error, without a fabricated one-item list, when a claim succeeds but the refetch also fails", async () => {
    const claimed = guildOf({ guildId: "g9", name: "New Room" });
    const myGuilds = vi.fn().mockRejectedValue(new Error("guilds offline"));
    const claimGuild = vi.fn(async () => ({ guild: claimed, upgrade: false }));
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage
          api={{ myGuilds, claimGuild, guildPacks: async () => [] } as unknown as Api}
          availability="available"
          onRetryPlan={noop}
          pending={{ kind: "guild", code: "CODE1" }}
        />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claim it for this account" }));
    await waitFor(() => expect(myGuilds).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    expect(screen.queryByText("New Room")).toBeNull();
  });

  it("decides refetch-vs-write from live state, not the render closure captured before a claim's own await", async () => {
    const pendingClaim = deferred<{ guild: Guild; upgrade: boolean }>();
    const firstMyGuilds = vi.fn(async () => ({ guilds: [], server: false, open: true, allowed: 3 }));
    const claimGuild = vi.fn(() => pendingClaim.promise);
    planResult.value = planWith("upgrade");
    const { rerender } = render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage
          api={{ myGuilds: firstMyGuilds, claimGuild, guildPacks: async () => [] } as unknown as Api}
          availability="available"
          onRetryPlan={noop}
          pending={{ kind: "guild", code: "CODE1" }}
        />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText("No servers yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Claim it for this account" }));

    // While that claim is still awaiting, the list itself flips underneath
    // it (here, standing in for any concurrent cause): a fresh api whose
    // read fails takes over, so live state is now an error, not the "ready"
    // state the claim's closure saw when it started.
    const secondMyGuilds = vi
      .fn()
      .mockRejectedValueOnce(new Error("list interleaved"))
      .mockResolvedValueOnce({ guilds: [guildOf({ guildId: "g9", name: "New Room" })], server: false, open: true, allowed: 9 });
    rerender(
      <AccountContext.Provider value={signedIn}>
        <ServersPage
          api={{ myGuilds: secondMyGuilds, claimGuild: vi.fn(), guildPacks: async () => [] } as unknown as Api}
          availability="available"
          onRetryPlan={noop}
          pending={{ kind: "guild", code: "CODE1" }}
        />
      </AccountContext.Provider>,
    );
    expect(await screen.findByText(/list interleaved/)).toBeTruthy();

    await act(async () => pendingClaim.resolve({ guild: guildOf({ guildId: "g9", name: "New Room" }), upgrade: false }));

    // The claim decided from the live (error) state, not the stale "ready"
    // it saw at click time: it asks the server again rather than writing
    // into a list that no longer exists, and the claimed server shows up
    // once that refetch succeeds, with no manual Retry needed.
    await waitFor(() => expect(secondMyGuilds).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("New Room")).toBeTruthy();
    expect(screen.getByText(/up to 9 servers/)).toBeTruthy();
  });
});

describe("a pending server claim outside a normal Servers page", () => {
  it("keeps the pending claim banner and Not now over an unsupported deployment, without calling claimGuild", () => {
    const claimGuild = vi.fn();
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage
          api={{ claimGuild } as unknown as Api}
          availability="unavailable"
          onRetryPlan={noop}
          pending={{ kind: "guild", code: "CODE1" }}
        />
      </AccountContext.Provider>,
    );

    expect(screen.getByText("Discord asked to claim a server for this account.")).toBeTruthy();
    expect(screen.getByText("Servers are not available on this deployment.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Claim it for this account" })).toBeNull();
    expect(claimGuild).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Discord asked to claim a server for this account.")).toBeNull();
  });

  it("keeps the pending token after a failed claim", async () => {
    const claimGuild = vi.fn(async () => {
      throw new Error("claim failed");
    });
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage
          api={
            {
              claimGuild,
              myGuilds: async () => ({ guilds: [], server: false, open: true, allowed: 3 }),
              guildPacks: async () => [],
            } as unknown as Api
          }
          availability="available"
          onRetryPlan={noop}
          pending={{ kind: "guild", code: "CODE1" }}
        />
      </AccountContext.Provider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Claim it for this account" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("claim failed"));
    expect(screen.getByText("Discord asked to claim a server for this account.")).toBeTruthy();
  });

  it("keeps the stored pending token when the server list itself fails", async () => {
    sessionStorage.setItem("runlog:link", JSON.stringify({ kind: "guild", code: "CODEX" }));
    const myGuilds = vi.fn(async () => {
      throw new Error("guilds offline");
    });
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds, guildPacks: async () => [] } as unknown as Api} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    expect(screen.getByText("Discord asked to claim a server for this account.")).toBeTruthy();
    expect(sessionStorage.getItem("runlog:link")).toBe(JSON.stringify({ kind: "guild", code: "CODEX" }));
  });

  it("keeps the stored pending token after the server list's own Retry also fails", async () => {
    sessionStorage.setItem("runlog:link", JSON.stringify({ kind: "guild", code: "CODEX" }));
    const myGuilds = vi.fn(async () => {
      throw new Error("guilds offline");
    });
    planResult.value = planWith("upgrade");
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={{ myGuilds, guildPacks: async () => [] } as unknown as Api} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );

    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(myGuilds).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/guilds offline/)).toBeTruthy();
    expect(screen.getByText("Discord asked to claim a server for this account.")).toBeTruthy();
    expect(sessionStorage.getItem("runlog:link")).toBe(JSON.stringify({ kind: "guild", code: "CODEX" }));
  });
});

describe("the watch party setting on a server", () => {
  it("normalizes an owner-provided shelf by removing tombstones and sorting titles", async () => {
    const pack = (id: string, title: string, deletedAt?: string): StoredPack => ({
      id,
      title,
      version: "1",
      format: "yaml",
      source: "schemaVersion: 1",
      filename: `${id}.yaml`,
      importedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...(deletedAt ? { deletedAt } : {}),
    });
    show(
      guildOf({ watchParties: "packs" }),
      saves((g) => guildOf(g)),
      [pack("z", "Zulu Pack"), pack("deleted", "Deleted Pack", "2026-02-01T00:00:00Z"), pack("a", "Alpha Pack")],
    );

    await screen.findByLabelText("Watch parties");
    expect(screen.queryByLabelText("Deleted Pack")).toBeNull();
    expect(screen.getAllByRole("checkbox").map((box) => box.parentElement?.textContent?.trim())).toEqual(["Alpha Pack", "Zulu Pack"]);
    expect(
      Array.from((screen.getByLabelText("A pack to add to The Kiln Room") as HTMLSelectElement).options).map((option) => option.text),
    ).toEqual(["Add a pack from your shelf…", "Alpha Pack", "Zulu Pack"]);
  });

  it("is not offered before the servers have been read", () => {
    const { container } = render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={null} availability="available" onRetryPlan={noop} />
      </AccountContext.Provider>,
    );
    expect(container.textContent).not.toContain("Watch parties");
  });

  it("shows the mode the server already holds, and the packs it chose", async () => {
    show(guildOf({ watchParties: "packs", watchPackIds: ["com.example.kiln"] }), saves(guildOf));
    const select = (await screen.findByLabelText("Watch parties")) as HTMLSelectElement;
    expect(select.value).toBe("packs");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Off", "Every run", "Chosen packs"]);
    expect((screen.getByLabelText("The Long Kiln") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Wheel and Wire") as HTMLInputElement).checked).toBe(false);
  });

  it("saves the mode the moment it is chosen, with no second press", async () => {
    show(
      guildOf(),
      saves((g) => guildOf(g)),
    );
    const select = await screen.findByLabelText("Watch parties");
    expect((select as HTMLSelectElement).value).toBe("off");
    fireEvent.change(select, { target: { value: "every" } });
    await waitFor(() => expect((screen.getByLabelText("Watch parties") as HTMLSelectElement).value).toBe("every"));
    expect(asked).toEqual([["g1", "every", undefined]]);
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("offers the shelf once the mode is chosen packs, and sends the ids as they are ticked", async () => {
    show(
      guildOf({ watchParties: "packs", watchPackIds: ["com.example.kiln"] }),
      saves((g) => guildOf(g)),
    );
    fireEvent.click(await screen.findByLabelText("Wheel and Wire"));
    await waitFor(() => expect((screen.getByLabelText("Wheel and Wire") as HTMLInputElement).checked).toBe(true));
    expect(asked).toEqual([["g1", "packs", ["com.example.kiln", "com.example.other"]]]);
    fireEvent.click(screen.getByLabelText("The Long Kiln"));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toEqual(["g1", "packs", ["com.example.other"]]);
  });

  it("shows nothing to choose from until the mode is chosen packs", async () => {
    show(
      guildOf({ watchParties: "every" }),
      saves((g) => guildOf(g)),
    );
    await screen.findByLabelText("Watch parties");
    expect(screen.queryByLabelText("The Long Kiln")).toBeNull();
    fireEvent.change(screen.getByLabelText("Watch parties"), { target: { value: "packs" } });
    expect(await screen.findByLabelText("The Long Kiln")).toBeTruthy();
  });

  it("says so where the setting could not be saved", async () => {
    show(guildOf(), async () => {
      throw new Error("that setting could not be saved");
    });
    fireEvent.change(await screen.findByLabelText("Watch parties"), { target: { value: "every" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("that setting could not be saved"));
  });
});
