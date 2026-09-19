// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** The page with one claimed server, and the calls the setting makes recorded. */
function show(guild: Guild, setWatchParties: Api["setWatchParties"], shelf?: StoredPack[]) {
  const api = {
    myGuilds: async () => ({ guilds: [guild], server: true, open: false, allowed: 3 }),
    guildPacks: async () => [],
    setWatchParties,
  } as unknown as Api;
  render(
    <AccountContext.Provider value={signedIn}>
      <ServersPage api={api} {...(shelf ? { shelf } : {})} />
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
        <ServersPage api={service(checkout)} />
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
        <ServersPage api={service()} />
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
        <ServersPage api={service()} />
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
        <ServersPage api={service()} />
      </AccountContext.Provider>,
    );
    expect(await screen.findByRole("button", { name: "Servers, $9 a month" })).toBeTruthy();

    cleanup();
    planResult.value = planWith("available", true);
    render(
      <AccountContext.Provider value={signedIn}>
        <ServersPage api={service()} />
      </AccountContext.Provider>,
    );
    await screen.findByText(/Runlog for servers, active/);
    expect(screen.queryByRole("button", { name: "Servers, $9 a month" })).toBeNull();
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
        <ServersPage api={null} />
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
