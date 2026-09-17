// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SyncError, type Api, type Profile } from "../sync/client.ts";
import { forgetProfile, rememberProfile } from "../sync/useProfile.ts";
import { AccountContext, type Account } from "./Account.tsx";
import { NameGate } from "./NameGate.tsx";

/**
 * The gate that asks for the name other people see.
 *
 * A browser for this one: what is under test is what a press does when
 * the server says the name belongs to somebody else, and what the gate
 * says to an account whose name was taken while it was away.
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

const signedIn: Account = {
  status: "signed-in",
  user: {
    object: "user",
    id: "user_ME",
    email: "n@example.com",
    emailVerified: true,
    firstName: "Nate",
    lastName: null,
    profilePictureUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastSignInAt: null,
    externalId: undefined,
  },
  signOut: () => {},
  getAccessToken: async () => "token",
};

/** A handful of microtask turns, for the promise chain a press starts. */
async function flush(turns = 4) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

const show = async (profile: Profile, options: { taken?: boolean; api?: Partial<Api> } = {}) => {
  current.api = { me: async () => ({ profile }), ...options.api } as unknown as Api;
  rememberProfile(profile, options.taken === true);
  render(
    <AccountContext.Provider value={signedIn}>
      <NameGate />
    </AccountContext.Provider>,
  );
  await flush();
};

// The box is named by the words above it now, a real label tied to it by
// `for`, rather than by an `aria-label` nobody sees; see ui/Field.tsx.
const field = () => screen.getByLabelText("Shown as") as HTMLInputElement;

afterEach(() => {
  cleanup();
  forgetProfile();
  current.api = null;
});

describe("the name gate", () => {
  it("keeps the draft and says so when the name belongs to another account", async () => {
    const asked: string[] = [];
    await show(
      { createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", name: "Nate Ferrell" },
      {
        api: {
          putProfile: async (snapshot) => {
            asked.push(snapshot.handle ?? "");
            throw new SyncError("conflict");
          },
        },
      },
    );
    fireEvent.change(field(), { target: { value: "Kiln Keeper" } });
    fireEvent.click(screen.getByText("Use this name"));
    await flush();
    expect(asked).toEqual(["Kiln Keeper"]);
    expect(screen.getByText("That name is taken.")).toBeTruthy();
    expect(field().value).toBe("Kiln Keeper");
  });

  it("asks again, with the name that was taken, when somebody else holds it now", async () => {
    await show(
      { createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", handle: "Ember", handleSetAt: "2026-01-02T00:00:00Z" },
      { taken: true },
    );
    expect(screen.getByText("Someone else is shown as Ember now. Pick another.")).toBeTruthy();
    expect(field().value).toBe("Ember");
  });

  it("stays out of the way of an account whose name is its own", async () => {
    await show({
      createdAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
      handle: "Ember",
      handleSetAt: "2026-01-02T00:00:00Z",
    });
    expect(screen.queryByLabelText("Shown as")).toBeNull();
  });
});
