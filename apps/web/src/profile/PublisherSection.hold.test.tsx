// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedProvider } from "../hosted/HostedProvider.tsx";
import type { Hosted } from "../hosted/config.ts";
import type { Api, PublisherView } from "../sync/client.ts";
import type { Plan, PlanAccess } from "../sync/usePlan.ts";
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
    const refresh = vi.fn(async () => {});
    plan = { state, access: () => (state.kind === "error" ? "error" : "checking"), refresh };
    render(<PublisherSection api={api} />);
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText("Become a publisher")).toBeNull();
    if (state.kind === "error") {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refresh).toHaveBeenCalledOnce();
    }
  });

  it.each([
    ["held", planOf(true, false)],
    ["in error", { state: { kind: "error", ownerId: "A", message: "offline" }, access: () => "error", refresh: async () => {} } as Plan],
  ])("keeps an existing publisher's organization usable while the plan is %s", async (_description, publisherPlan) => {
    plan = publisherPlan;
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
      sales: async () => [
        {
          ref: "sale_1",
          packId: "pack_1",
          title: "Ember Trail",
          buyerEmail: "buyer@example.test",
          amount: 400,
          currency: "usd",
          fee: 20,
          status: "fulfilled",
          createdAt: "2026-01-01T00:00:00Z",
          fulfilledAt: "2026-01-01T00:00:00Z",
          revokedAt: null,
        },
      ],
    } as unknown as Api;
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={existingApi} />
      </HostedProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Publishing as Cinder & Salt" })).toBeTruthy();
    expect(screen.getByText("Your packs in the marketplace")).toBeTruthy();
    expect(screen.getByText("People in Cinder & Salt")).toBeTruthy();
    expect(screen.getByText(/Payouts are set up/)).toBeTruthy();
    expect(await screen.findByText("Sales")).toBeTruthy();
  });
});

/**
 * Hosted licensing, nested under a founder's Publishing: its own checking,
 * sign-in and error notices stay scoped to that subsection, and a failed
 * entitlement read never hides the packs, members or sales lists that sit
 * beside it.
 */
describe("hosted licensing's exhaustive access handling", () => {
  const founder: PublisherView = {
    id: "pub_1",
    name: "Cinder & Salt",
    owner: true,
    connectStarted: true,
    connectReady: true,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const founderApi = (): Api =>
    ({
      myPublisher: async () => founder,
      publisherPacks: async () => [{ packId: "pack_1", head: { title: "Ember Trail", version: "1" }, status: "listed" }],
      publisherMembers: async () => ({ members: [], invitations: [] }),
      sales: async () => [],
    }) as unknown as Api;

  it.each([
    [{ kind: "loading", ownerId: "A" } as const, (): PlanAccess => "checking", /Checking your plan/],
    [{ kind: "error", ownerId: "A", message: "offline" } as const, (): PlanAccess => "error", /plan could not be checked/],
  ])("scopes a checking or failed entitlement read to Hosted licensing alone", async (state, access, message) => {
    const refresh = vi.fn(async () => {});
    plan = { state, access, refresh };
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={founderApi()} />
      </HostedProvider>,
    );

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText("Your packs in the marketplace")).toBeTruthy();
    expect(screen.getByText("People in Cinder & Salt")).toBeTruthy();
    if (state.kind === "error") {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refresh).toHaveBeenCalledOnce();
    }
  });

  it("explains the 5% fee and offers checkout where the capability is missing and the tier is open", async () => {
    plan = {
      state: {
        kind: "ready",
        ownerId: "A",
        gates: true,
        capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
        offers: { servers: false, serversOpen: false, publishersOpen: true },
      },
      access: () => "upgrade",
      refresh: async () => {},
    };
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={founderApi()} />
      </HostedProvider>,
    );

    expect(await screen.findByText(/takes 5% of each sale/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "$9 a month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "$90 a year" })).toBeTruthy();
  });

  it("sends hosted licensing's Checkout and Portal back to Publishing, remembered for this account", async () => {
    sessionStorage.clear();
    const ready = (waived: boolean): Plan => ({
      state: {
        kind: "ready",
        ownerId: "A",
        gates: true,
        capabilities: { hostTables: false, waivePublisherFee: waived, hostServers: false },
        offers: { servers: false, serversOpen: false, publishersOpen: true },
      },
      access: () => (waived ? "available" : "upgrade"),
      refresh: async () => {},
    });
    const checkout = vi.fn<Api["checkout"]>(async () => ({ available: false }));
    const portal = vi.fn<Api["portal"]>(async () => new Promise<never>(() => {}));
    plan = ready(false);
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={{ ...founderApi(), checkout, portal } as Api} />
      </HostedProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "$90 a year" }));
    await waitFor(() => expect(screen.getByText("Billing is not switched on here yet.")).toBeTruthy());
    expect(checkout).toHaveBeenCalledWith("hosted-yearly", "publishing");
    // Nobody left for Stripe, so nothing is waiting to come back.
    expect(sessionStorage.getItem("runlog:profile-return")).toBeNull();
    cleanup();

    plan = ready(true);
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={{ ...founderApi(), checkout, portal } as Api} />
      </HostedProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Manage subscription" }));
    expect(portal).toHaveBeenCalledWith("publishing");
    expect(JSON.parse(sessionStorage.getItem("runlog:profile-return") ?? "null")).toEqual({
      kind: "portal",
      ownerId: "A",
      destination: "publishing",
    });
  });

  it("says the fee is waived where the capability is present, with no checkout offered", async () => {
    plan = {
      state: {
        kind: "ready",
        ownerId: "A",
        gates: true,
        capabilities: { hostTables: false, waivePublisherFee: true, hostServers: false },
        offers: { servers: false, serversOpen: false, publishersOpen: true },
      },
      access: () => "available",
      refresh: async () => {},
    };
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={founderApi()} />
      </HostedProvider>,
    );

    expect(await screen.findByText(/takes no share of your sales/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "$9 a month" })).toBeNull();
  });

  it("removes new checkout without hiding publisher management where publishersOpen is false", async () => {
    plan = {
      state: {
        kind: "ready",
        ownerId: "A",
        gates: true,
        capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
        offers: { servers: false, serversOpen: false, publishersOpen: false },
      },
      access: () => "upgrade",
      refresh: async () => {},
    };
    render(
      <HostedProvider value={hosted}>
        <PublisherSection api={founderApi()} />
      </HostedProvider>,
    );

    expect(await screen.findByText(/not on sale here yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "$9 a month" })).toBeNull();
    expect(screen.getByText("Your packs in the marketplace")).toBeTruthy();
    expect(screen.getByText("People in Cinder & Salt")).toBeTruthy();
  });
});
