// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A session shared by every tab on the device: another tab can sign in as
 * someone else, and this tab's next token then names that person. Every
 * token this tab hands out has to name the user it signed in as.
 */
vi.hoisted(() => {
  vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
});

type Options = { onRefresh?: (r: { user: { id: string } | null }) => void };
const workos = vi.hoisted(() => ({
  token: "",
  asked: 0,
  options: null as null | Options,
}));
vi.mock("@workos-inc/authkit-js", async (original) => {
  const real = await original<typeof import("@workos-inc/authkit-js")>();
  return {
    ...real,
    createClient: async (_id: string, options: Options) => {
      workos.options = options;
      return {
        getUser: () => ({ object: "user", id: "user_A", email: "a@example.com" }),
        signIn: async () => {},
        signUp: async () => {},
        signOut: () => {},
        getAccessToken: async () => {
          workos.asked += 1;
          return workos.token;
        },
        dispose: () => {},
      };
    },
  };
});

const { AccountProvider, CHANGED_HANDS_KEY, tokenSubject, useAccount } = await import("./Account.tsx");
type Account = ReturnType<typeof useAccount>;

const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwtFor = (sub: string) => `${b64url({ alg: "none" })}.${b64url({ sub })}.x`;

let current: Account | null = null;
function Probe() {
  current = useAccount();
  return null;
}

let reload: ReturnType<typeof vi.fn>;
let real: Location;
beforeEach(() => {
  workos.token = jwtFor("user_A");
  workos.asked = 0;
  workos.options = null;
  current = null;
  sessionStorage.clear();
  real = window.location;
  reload = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...real, reload } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: real });
});

async function signedIn() {
  render(
    <AccountProvider>
      <Probe />
    </AccountProvider>,
  );
  await waitFor(() => expect(current?.status).toBe("signed-in"));
  if (current?.status !== "signed-in") throw new Error("not signed in");
  return current;
}

describe("a token that names someone else", () => {
  it("hands out a token that names the signed-in user", async () => {
    const account = await signedIn();
    await expect(account.getAccessToken()).resolves.toBe(jwtFor("user_A"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses a token for another account, stops using the session, and reloads once", async () => {
    const account = await signedIn();
    workos.token = jwtFor("user_B");
    await act(async () => {
      await expect(account.getAccessToken()).rejects.toThrow("signed out");
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(current?.status).toBe("checking");
    // Nothing more is asked of the session in this tab.
    const asked = workos.asked;
    await expect(account.getAccessToken()).rejects.toThrow("signed out");
    expect(workos.asked).toBe(asked);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("treats a token it cannot read as someone else's", async () => {
    const account = await signedIn();
    workos.token = "not-a-jwt";
    await act(async () => {
      await expect(account.getAccessToken()).rejects.toThrow("signed out");
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("notices a refresh for someone else before anything asks for a token", async () => {
    await signedIn();
    act(() => workos.options?.onRefresh?.({ user: { id: "user_B" } }));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => workos.options?.onRefresh?.({ user: { id: "user_A" } }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores a refresh for the same user", async () => {
    await signedIn();
    act(() => workos.options?.onRefresh?.({ user: { id: "user_A" } }));
    expect(reload).not.toHaveBeenCalled();
    expect(current?.status).toBe("signed-in");
  });

  it("refuses every call that was already waiting, and still reloads only once", async () => {
    const account = await signedIn();
    workos.token = jwtFor("user_B");
    await act(async () => {
      const results = await Promise.allSettled([account.getAccessToken(), account.getAccessToken(), account.getAccessToken()]);
      expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("signs this tab out rather than reload when it cannot remember reloading", async () => {
    const account = await signedIn();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private window");
    });
    try {
      workos.token = jwtFor("user_B");
      await act(async () => {
        await expect(account.getAccessToken()).rejects.toThrow("signed out");
      });
      expect(reload).not.toHaveBeenCalled();
      expect(current?.status).toBe("anonymous");
    } finally {
      setItem.mockRestore();
    }
  });

  it("signs this tab out instead of reloading twice in a minute", async () => {
    sessionStorage.setItem(CHANGED_HANDS_KEY, String(Date.now()));
    const account = await signedIn();
    workos.token = jwtFor("user_B");
    await act(async () => {
      await expect(account.getAccessToken()).rejects.toThrow("signed out");
    });
    expect(reload).not.toHaveBeenCalled();
    expect(current).toMatchObject({ status: "anonymous", problem: "Signed in as someone else in another tab. Reload this page." });
  });
});

describe("the token's subject", () => {
  it("reads the sub claim, and nothing else counts", () => {
    expect(tokenSubject(jwtFor("user_A"))).toBe("user_A");
    expect(tokenSubject("token")).toBeNull();
    expect(tokenSubject(`${b64url({ alg: "none" })}.${b64url({ sub: 7 })}.x`)).toBeNull();
    expect(tokenSubject(`${b64url({ alg: "none" })}.${b64url({})}.x`)).toBeNull();
  });
});
