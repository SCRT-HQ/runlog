// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PackServers } from "./PackServers.tsx";
import type { GuildVaults } from "./useGuildVaults.ts";
import type { StoredPack } from "../storage/db.ts";

const pack = { id: "demo", title: "Any Given Day", version: "1.0.0", format: "yaml", source: "" } as unknown as StoredPack;
const vaults = (over: Partial<GuildVaults> = {}): GuildVaults => ({
  guilds: [],
  holding: {},
  busy: null,
  set: async () => null,
  ...over,
});
const guild = (guildId: string, name: string) => ({ guildId, name, ownerSub: "s", claimedAt: "", updatedAt: "" });

afterEach(cleanup);

describe("which servers may play a pack", () => {
  it("draws nothing where no server is claimed", () => {
    const { container } = render(<PackServers pack={pack} vaults={vaults()} />);
    expect(container.innerHTML).toBe("");
  });

  it("says the answer on the button, not the question", () => {
    const guilds = [guild("1", "The studio"), guild("2", "The kiln")];
    const { rerender } = render(<PackServers pack={pack} vaults={vaults({ guilds })} />);
    expect(screen.getByRole("group").textContent).toContain("No server");
    rerender(<PackServers pack={pack} vaults={vaults({ guilds, holding: { "1": new Set(["demo"]) } })} />);
    expect(screen.getByRole("group").textContent).toContain("1 of 2 servers");
    rerender(<PackServers pack={pack} vaults={vaults({ guilds, holding: { "1": new Set(["demo"]), "2": new Set(["demo"]) } })} />);
    expect(screen.getByRole("group").textContent).toContain("Every server");
  });

  it("ticks the servers holding it, and asks to put it in the ones that are not", async () => {
    const asked: Array<[string, boolean]> = [];
    const guilds = [guild("1", "The studio"), guild("2", "The kiln")];
    render(
      <PackServers
        pack={pack}
        vaults={vaults({
          guilds,
          holding: { "1": new Set(["demo"]) },
          set: async (_p, guildId, on) => {
            asked.push([guildId, on]);
            return null;
          },
        })}
      />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    fireEvent.click(boxes[1]!);
    expect(asked).toEqual([["2", true]]);
    fireEvent.click(boxes[0]!);
    expect(asked).toEqual([["2", true], ["1", false]]);
  });
});
