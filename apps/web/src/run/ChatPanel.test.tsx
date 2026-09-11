// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import type { Pack } from "@runlog/rules-schema";
import type { Api } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { ChatSettings } from "./ChatPanel.tsx";

/**
 * The Chat section under a run's Settings: minting the key that lets chat
 * ask for a move or a roll.
 *
 * The key is shown once. If the press leaves the panel where it was, the
 * key that was just made is on nobody's screen and gone for good, so what
 * is under test is that the press changes the panel.
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => ({ gates: false, entitlements: [], can: () => true, servers: false, serversOpen: true, publishersOpen: true, loaded: true, refresh: async () => {} }) }));

const pack = {
  id: "demo",
  vocabulary: { unit: { one: "Room", many: "Rooms" }, subject: { one: "Track", many: "Tracks" }, run: { one: "Run", many: "Runs" } },
  moves: { salvage: { label: "Salvage a Piece", when: "anytime", do: [] } },
  tables: {},
} as unknown as Pack;

const record = (over: Partial<StoredRun> = {}): StoredRun => ({ runId: "r1", packId: "demo", role: "owner", events: [], ...over }) as unknown as StoredRun;

const api = (over: Partial<Api> = {}): Api =>
  ({
    mintAskKey: async () => ({ key: "the-key", policy: "ask" as const }),
    streamKeys: async () => ({}),
    mintStreamKey: async () => ({ key: "the-press-key", keys: { press: { madeAt: "2026-09-11T00:00:00Z" } } }),
    revokeStreamKey: async () => ({}),
    setAskPolicy: async () => {},
    revokeAskKey: async () => {},
    ...over,
  }) as unknown as Api;

afterEach(() => {
  current.api = null;
  cleanup();
});

describe("taking asks from chat", () => {
  it("shows the minted key and the address a bot posts to, on the press that makes it", async () => {
    current.api = api();
    render(<ChatSettings pack={pack} record={record()} />);
    await act(async () => {
      screen.getByRole("button", { name: "Take asks" }).click();
    });
    await waitFor(() => expect(screen.getByText(/the-key/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Take asks" })).toBeNull();
  });

  it("hands over one address for every run, and presses it to prove the wiring", async () => {
    current.api = api();
    render(<ChatSettings pack={pack} record={record()} />);
    await act(async () => {
      screen.getByRole("button", { name: "Make a press key" }).click();
    });
    // The account's address, not the run's: it carries no run id at all.
    await waitFor(() => expect(screen.getByText(/the-press-key/)).toBeTruthy());
    const shown = screen.getByText(/the-press-key/).textContent ?? "";
    expect(shown).toContain("/public/stream/asks");
    expect(shown).not.toContain("r1");
    expect(screen.getByRole("button", { name: "Try it" })).toBeTruthy();
  });

  it("names the rewards a pack answers to, rather than ids to retype", async () => {
    current.api = api();
    render(<ChatSettings pack={pack} record={record()} />);
    // One action serves every reward, so what the panel lists is what to
    // call one: the word Roll, and each move by the name the pack gives it.
    expect(screen.getByText("Roll")).toBeTruthy();
    expect(screen.getByText("Salvage a Piece")).toBeTruthy();
  });

  it("says why when the key could not be made", async () => {
    current.api = api({
      mintAskKey: async () => {
        throw new Error("no key could be made");
      },
    });
    render(<ChatSettings pack={pack} record={record()} />);
    await act(async () => {
      screen.getByRole("button", { name: "Take asks" }).click();
    });
    await waitFor(() => expect(screen.getByText("no key could be made")).toBeTruthy());
  });
});
