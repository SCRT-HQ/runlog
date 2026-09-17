// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api, Guild } from "../sync/client.ts";
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
function show(guild: Guild, setWatchParties: Api["setWatchParties"]) {
  const api = {
    myGuilds: async () => ({ guilds: [guild], server: true, open: false, allowed: 3 }),
    guildPacks: async () => [],
    setWatchParties,
  } as unknown as Api;
  render(
    <AccountContext.Provider value={signedIn}>
      <ServersPage api={api} />
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
});

describe("the watch party setting on a server", () => {
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
