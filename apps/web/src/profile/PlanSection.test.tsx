// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Hosted } from "../hosted/config.ts";
import type { Api } from "../sync/client.ts";
import type { Plan } from "../sync/usePlan.ts";
import { PlanSection } from "./PlanSection.tsx";

const context = vi.hoisted(() => ({ hosted: null as Hosted | null, plan: null as Plan | null }));
vi.mock("../hosted/HostedProvider.tsx", () => ({ useHosted: () => context.hosted }));
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => context.plan }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const hosted = (billing: boolean, pricing = "https://example.test/pricing"): Hosted => ({
  operator: "Example",
  support: "support@example.test",
  termsVersion: "v1",
  links: { terms: "https://example.test/terms", privacy: "https://example.test/privacy", pricing },
  features: { billing, testing: false },
});

function plan(overrides: { gates?: boolean; subscribed?: boolean; state?: Plan["state"]; refresh?: Plan["refresh"] } = {}): Plan {
  const state: Plan["state"] =
    overrides.state ??
    ({
      kind: "ready",
      ownerId: "A",
      gates: overrides.gates ?? true,
      capabilities: { hostTables: overrides.subscribed ?? false, waivePublisherFee: false, hostServers: false },
      offers: { servers: true, serversOpen: true, publishersOpen: true },
    } as const);
  return {
    state,
    access: () =>
      state.kind === "ready"
        ? state.capabilities.hostTables || !state.gates
          ? "available"
          : "upgrade"
        : state.kind === "error"
          ? "error"
          : "checking",
    refresh: overrides.refresh ?? vi.fn(async () => {}),
  };
}

function api(overrides: Partial<Api> = {}): Api {
  return {
    checkout: vi.fn(async () => ({ available: false as const })),
    portal: vi.fn(async () => ({ available: false as const })),
    refreshEntitlements: vi.fn(async () => []),
    ...overrides,
  } as unknown as Api;
}

beforeEach(() => {
  context.hosted = hosted(true);
  context.plan = plan();
  history.replaceState(null, "", "/account");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("plan visibility and current choices", () => {
  it.each([
    [{ kind: "loading", ownerId: "A" } as const, /Checking your plan/],
    [{ kind: "error", ownerId: "A", message: "offline" } as const, /plan could not be checked/],
  ])("fails closed for $state.kind", (state, message) => {
    context.plan = plan({ state });

    render(<PlanSection api={api()} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plus, $4 a month" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
  });

  it("stays absent without an API or anything billed or gated", () => {
    const service = api();
    context.hosted = hosted(false);
    context.plan = plan({ gates: false });
    const view = render(<PlanSection api={null} />);
    expect(screen.queryByRole("heading", { name: /Plan:/ })).toBeNull();
    view.rerender(<PlanSection api={service} />);
    expect(screen.queryByRole("heading", { name: /Plan:/ })).toBeNull();
  });

  it("keeps Free and Plus copy, eligibility, and the pricing navigation", () => {
    const service = api();
    const view = render(<PlanSection api={service} />);
    expect(screen.getByRole("heading", { name: "Plan: Free" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plus, $4 a month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "$36 a year" })).toBeTruthy();
    const pricing = screen.getByRole("link", { name: "What each plan has" });
    expect(pricing.tagName).toBe("A");
    expect(pricing.getAttribute("href")).toBe("https://example.test/pricing");

    context.plan = plan({ subscribed: true });
    view.rerender(<PlanSection api={service} />);
    expect(screen.getByRole("heading", { name: "Plan: Plus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plus, $4 a month" })).toBeNull();
  });
});

describe("plan actions", () => {
  it.each([
    ["Plus, $4 a month", "plus-monthly"],
    ["$36 a year", "plus-yearly"],
  ] as const)("starts %s once and disables conflicting actions", async (label, sku) => {
    const pending = deferred<{ available: false }>();
    const checkout = vi.fn(() => pending.promise);
    const service = api({ checkout });
    render(<PlanSection api={service} />);

    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Opening checkout…" }));
    expect(checkout).toHaveBeenCalledOnce();
    expect(checkout).toHaveBeenCalledWith(sku);
    const active = screen.getByRole("button", { name: "Opening checkout…" }) as HTMLButtonElement;
    expect(active.disabled).toBe(true);
    expect(active.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => pending.resolve({ available: false }));
    expect(screen.getByRole("status").textContent).toBe("Billing is not switched on here yet.");
  });

  it("starts the portal once with its own busy label", async () => {
    context.plan = plan({ subscribed: true });
    const pending = deferred<{ available: false }>();
    const portal = vi.fn(() => pending.promise);
    render(<PlanSection api={api({ portal })} />);

    fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
    fireEvent.click(screen.getByRole("button", { name: "Opening billing…" }));
    expect(portal).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Opening billing…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => pending.resolve({ available: false }));
  });

  it("runs Refresh as one guarded sequence and restores it after rejection", async () => {
    const entitlements = deferred<string[]>();
    const refreshEntitlements = vi
      .fn<Api["refreshEntitlements"]>()
      .mockReturnValueOnce(entitlements.promise)
      .mockRejectedValueOnce(new Error("offline detail"));
    const refresh = vi.fn(async () => {});
    context.plan = plan({ refresh });
    render(<PlanSection api={api({ refreshEntitlements })} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refreshing…" }));
    expect(refreshEntitlements).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Refreshing…" }).getAttribute("aria-busy")).toBe("true");

    await act(async () => entitlements.resolve([]));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => void (await Promise.resolve()));
    expect(screen.getByRole("status").textContent).toMatch(/could not be refreshed/i);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(["a replacement API", "the same API returning after null"] as const)(
    "does not start an obsolete plan refresh after %s",
    async (transition) => {
      const oldEntitlements = deferred<string[]>();
      const currentEntitlements = deferred<string[]>();
      const oldPlanRefresh = vi.fn(async () => {});
      const currentPlanRefresh = vi.fn(async () => {});
      const sharedRefresh = vi
        .fn<Api["refreshEntitlements"]>()
        .mockReturnValueOnce(oldEntitlements.promise)
        .mockReturnValueOnce(currentEntitlements.promise);
      const first = api({ refreshEntitlements: sharedRefresh });
      const replacement = api({ refreshEntitlements: vi.fn(() => currentEntitlements.promise) });
      context.plan = plan({ refresh: oldPlanRefresh });
      const view = render(<PlanSection api={first} />);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

      context.plan = plan({ refresh: currentPlanRefresh });
      if (transition === "the same API returning after null") view.rerender(<PlanSection api={null} />);
      view.rerender(<PlanSection api={transition === "a replacement API" ? replacement : first} />);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

      await act(async () => oldEntitlements.resolve([]));
      expect(oldPlanRefresh).not.toHaveBeenCalled();
      expect(currentPlanRefresh).not.toHaveBeenCalled();
      const currentAction = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
      expect(currentAction.disabled).toBe(true);
      expect(currentAction.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("status").textContent).toBe("");

      await act(async () => currentEntitlements.resolve([]));
      expect(currentPlanRefresh).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("");
    },
  );

  it("reports rejected and unavailable mutations in one persistent status region", async () => {
    const checkout = vi
      .fn<Api["checkout"]>()
      .mockResolvedValueOnce({ available: false })
      .mockRejectedValueOnce(new Error("Checkout is temporarily unavailable."));
    render(<PlanSection api={api({ checkout })} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Plus, $4 a month" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Billing is not switched on here yet."));
    fireEvent.click(screen.getByRole("button", { name: "$36 a year" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Checkout is temporarily unavailable."));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("Stripe return and API ownership", () => {
  it.each([
    ["done", ["plus"], "You are on Plus."],
    ["done", [], "The payment went through; the plan lands in a moment. Press Refresh if it does not."],
    ["canceled", [], "Nothing was charged."],
  ] as const)("announces billing=%s and preserves unrelated address data", async (outcome, entitlements, message) => {
    history.replaceState(null, "", `/account?from=profile&billing=${outcome}#plans`);
    render(<PlanSection api={api({ refreshEntitlements: vi.fn(async () => [...entitlements]) })} />);
    await act(async () => void (await Promise.resolve()));

    expect(screen.getByRole("status").textContent).toBe(message);
    expect(location.pathname + location.search + location.hash).toBe("/account?from=profile#plans");
  });

  it("reports a failed billing return refresh", async () => {
    history.replaceState(null, "", "/account?billing=done");
    render(<PlanSection api={api({ refreshEntitlements: vi.fn(async () => Promise.reject(new Error("offline"))) })} />);
    await act(async () => void (await Promise.resolve()));
    expect(screen.getByRole("status").textContent).toBe(
      "The payment went through, but the plan could not be read just now. Press Refresh.",
    );
  });

  it("does not show old feedback or redirect after the API changes", async () => {
    const pending = deferred<{ url: string }>();
    const first = api({ checkout: vi.fn(() => pending.promise) });
    const second = api();
    const view = render(<PlanSection api={first} />);
    fireEvent.click(screen.getByRole("button", { name: "Plus, $4 a month" }));
    view.rerender(<PlanSection api={second} />);
    expect(screen.getByRole("status").textContent).toBe("");

    await act(async () => pending.resolve({ url: "#old-checkout" }));
    expect(location.hash).toBe("");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("does not let a rejected checkout from a replaced API disturb the replacement action", async () => {
    const oldCheckout = deferred<{ url: string } | { available: false }>();
    const currentCheckout = deferred<{ url: string } | { available: false }>();
    const first = api({ checkout: vi.fn(() => oldCheckout.promise) });
    const second = api({ checkout: vi.fn(() => currentCheckout.promise) });
    const view = render(<PlanSection api={first} />);
    fireEvent.click(screen.getByRole("button", { name: "Plus, $4 a month" }));

    view.rerender(<PlanSection api={second} />);
    fireEvent.click(screen.getByRole("button", { name: "$36 a year" }));
    await act(async () => oldCheckout.reject(new Error("old checkout failed")));

    const opening = screen.getByRole("button", { name: "Opening checkout…" }) as HTMLButtonElement;
    expect(opening.disabled).toBe(true);
    expect(opening.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("");
    expect(location.hash).toBe("");

    await act(async () => currentCheckout.resolve({ available: false }));
    expect(screen.getByRole("status").textContent).toBe("Billing is not switched on here yet.");
    expect(screen.getByRole("button", { name: "$36 a year" })).toBeTruthy();
  });

  it.each(["null", "another API"] as const)(
    "does not let a rejected portal from an earlier same-API lifecycle disturb the current action after %s",
    async (between) => {
      context.plan = plan({ subscribed: true });
      const oldPortal = deferred<{ url: string } | { available: false }>();
      const currentPortal = deferred<{ url: string } | { available: false }>();
      const portal = vi.fn<Api["portal"]>().mockReturnValueOnce(oldPortal.promise).mockReturnValueOnce(currentPortal.promise);
      const first = api({ portal });
      const view = render(<PlanSection api={first} />);
      fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

      view.rerender(<PlanSection api={between === "null" ? null : api()} />);
      view.rerender(<PlanSection api={first} />);
      fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
      await act(async () => oldPortal.reject(new Error("old portal failed")));

      const opening = screen.getByRole("button", { name: "Opening billing…" }) as HTMLButtonElement;
      expect(opening.disabled).toBe(true);
      expect(opening.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("status").textContent).toBe("");
      expect(location.hash).toBe("");

      await act(async () => currentPortal.resolve({ available: false }));
      expect(screen.getByRole("status").textContent).toBe("Billing is not switched on here yet.");
      expect(screen.getByRole("button", { name: "Manage subscription" })).toBeTruthy();
      expect(portal).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["null", "another API"] as const)("does not revive an old result when the same API returns through %s", async (between) => {
    const pending = deferred<{ available: false }>();
    const checkout = vi.fn<Api["checkout"]>().mockResolvedValueOnce({ available: false }).mockReturnValueOnce(pending.promise);
    const first = api({ checkout });
    const view = render(<PlanSection api={first} />);
    fireEvent.click(screen.getByRole("button", { name: "Plus, $4 a month" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Billing is not switched on here yet."));

    view.rerender(<PlanSection api={between === "null" ? null : api()} />);
    view.rerender(<PlanSection api={first} />);
    expect(screen.getByRole("status").textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Plus, $4 a month" }));
    view.rerender(<PlanSection api={between === "null" ? null : api()} />);
    view.rerender(<PlanSection api={first} />);

    await act(async () => pending.resolve({ available: false }));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("button", { name: "Plus, $4 a month" })).toBeTruthy();
    expect(checkout).toHaveBeenCalledTimes(2);
  });
});
