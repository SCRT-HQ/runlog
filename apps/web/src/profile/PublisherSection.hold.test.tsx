// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../sync/client.ts";
import type { Plan } from "../sync/usePlan.ts";
import { PublisherSection } from "./PublisherSection.tsx";

/**
 * The publisher tier can be held back by the operator: where plans gate
 * and the tier is not open yet, the section says so rather than offering
 * to make a publisher; where nothing gates, it offers as ever. The plan
 * comes from the API through a hook of its own, stood in for here.
 */
let plan: Plan;
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => plan, forgetPlan: () => {} }));

const planOf = (gates: boolean, publishersOpen: boolean): Plan => ({
  gates,
  entitlements: [],
  can: () => !gates,
  servers: false,
  serversOpen: false,
  publishersOpen,
  loaded: true,
  refresh: async () => {},
});
const api = { myPublisher: async () => null } as unknown as Api;

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
});
