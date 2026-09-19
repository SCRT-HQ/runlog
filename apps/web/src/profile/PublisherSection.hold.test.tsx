// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedProvider } from "../hosted/HostedProvider.tsx";
import type { Hosted } from "../hosted/config.ts";
import type { Api, PublisherView } from "../sync/client.ts";
import type { Plan } from "../sync/usePlan.ts";
import { PublisherSection } from "./PublisherSection.tsx";

/**
 * The publisher tier can be held back by the operator: where plans gate
 * and the tier is not open yet, the section says so rather than offering
 * to make a publisher; where nothing gates, it offers as ever. The plan
 * comes from the API through a hook of its own, stood in for here.
 */
let plan: Plan;
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => plan }));
vi.mock("../storage/db.ts", () => ({ listPacks: async () => [] }));

const planOf = (gates: boolean, publishersOpen: boolean): Plan => ({
  state: {
    kind: "ready",
    ownerId: "A",
    gates,
    capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
    offers: { servers: false, serversOpen: false, publishersOpen },
  },
  access: () => "upgrade",
  refresh: async () => {},
});
const api = { myPublisher: async () => null } as unknown as Api;
const hosted: Hosted = {
  operator: "Example",
  support: "support@example.test",
  termsVersion: "v1",
  links: { terms: "https://example.test/terms", privacy: "https://example.test/privacy" },
  features: { billing: true, testing: false },
};

afterEach(cleanup);

describe("the publisher tier's hold", () => {
  it("says coming soon instead of offering, where plans gate and the tier is not open", async () => {
    plan = planOf(true, false);
    render(<PublisherSection api={api} />);
    await waitFor(() => expect(screen.getByText("coming soon")).toBeTruthy());
    expect(screen.queryByText("Become a publisher")).toBeNull();
  });

  it("offers as ever where nothing gates, whatever the flag says, and where the tier is open", async () => {
    plan = planOf(false, false);
    render(<PublisherSection api={api} />);
    await waitFor(() => expect(screen.getByText("Become a publisher")).toBeTruthy());
    cleanup();
    plan = planOf(true, true);
    render(<PublisherSection api={api} />);
    await waitFor(() => expect(screen.getByText("Become a publisher")).toBeTruthy());
  });

  it.each([
    [{ kind: "loading", ownerId: "A" } as const, /Checking your plan/],
    [{ kind: "error", ownerId: "A", message: "offline" } as const, /plan could not be checked/],
  ])("does not expose the new-publisher form while plan state is $state.kind", async (state, message) => {
    plan = { state, access: () => (state.kind === "error" ? "error" : "checking"), refresh: async () => {} };
    render(<PublisherSection api={api} />);
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText("Become a publisher")).toBeNull();
  });

  it("retries a failed plan check while an existing publisher remains usable", async () => {
    const refresh = vi.fn(async () => {});
    plan = { state: { kind: "error", ownerId: "A", message: "offline" }, access: () => "error", refresh };
    const publisher: PublisherView = {
      id: "pub_1",
      name: "Cinder & Salt",
      owner: true,
      connectStarted: true,
      connectReady: true,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const existingApi = {
      myPublisher: async () => publisher,
      publisherPacks: async () => [],
      publisherMembers: async () => ({ members: [], invitations: [] }),
      sales: async () => [],
    } as unknown as Api;
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={existingApi} />
      </HostedProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Publishing as Cinder & Salt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
