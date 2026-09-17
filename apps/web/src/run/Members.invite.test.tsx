// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import type { Api } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { rememberLiveLink } from "../live/route.ts";
import { forgetProfile } from "../sync/useProfile.ts";
import { forgetWatchKey, watchKeyHere } from "./watchKey.ts";
import { Members } from "./Members.tsx";

/**
 * The three buttons under the table, pressed.
 *
 * A browser for this one, because what is under test is what a press
 * does: the sheet that opens, what it sends, what lands on the clipboard.
 * What the panel draws before anything is pressed is in Members.test.tsx.
 */

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

/**
 * The run's reachability, stood in for, with a real mint under it.
 *
 * The hook talks to the server on mount, which these tests do not answer;
 * what they do press is the minting, so that goes through the same helper
 * the hook uses and writes the key down the same way.
 */
const reach = vi.hoisted(() => ({ key: "watchkey" as string | null }));
vi.mock("./useReachable.ts", () => ({
  useReachable: (api: Api | null) => ({
    link: null,
    key: reach.key,
    working: false,
    mint: async () => {
      if (!api) return null;
      try {
        const { mintWatchKey } = await import("./watchKey.ts");
        const made = await mintWatchKey(api);
        reach.key = made.key;
        return made.key;
      } catch {
        // What the hook does: a refused mint is an answer, not a throw.
        return null;
      }
    },
  }),
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

const LINK = "https://runlog.test/#run/run-1?t=tok";

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

const sync: Sync = {
  available: true,
  enabled: true,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => false,
  drove: () => {},
};

const runOf = (extra: Partial<StoredRun> = {}): StoredRun => ({
  runId: "run-1",
  packId: kiln.id,
  packVersion: kiln.version,
  events: [],
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
  members: [{ sub: "user_ME", name: "Nate", role: "owner", joinedAt: "2026-01-01T00:00:00Z" }],
  ...extra,
});

/** What the panel asks the server for on its own, answered with nothing. */
const quiet = {
  me: async () => ({ profile: null }),
  reactions: async () => [],
  listInvites: async () => [],
  people: async () => [],
  parties: async () => ({ parties: [], servers: [] }),
};

const written: string[] = [];

/** A handful of microtask turns, for the promise chains the presses start. */
async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) await act(async () => await Promise.resolve());
}

/** The demo pack with its license said over: what the author allows decides what an invitation may offer. */
const packWith = (license: Partial<Pack["license"]>): Pack => ({ ...kiln, license: { ...kiln.license, ...license } });

const show = async (api: Partial<Api>, run: StoredRun = runOf(), pack: Pack = kiln) => {
  current.api = { ...quiet, ...api } as unknown as Api;
  render(
    <AccountContext.Provider value={signedIn}>
      <SyncContext.Provider value={sync}>
        <Members pack={pack} run={run} />
      </SyncContext.Provider>
    </AccountContext.Provider>,
  );
  await flush();
};

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(() => {
  current.api = null;
  reach.key = "watchkey";
  rememberLiveLink("run-1", null);
  forgetProfile();
  forgetWatchKey();
  cleanup();
});

describe("inviting someone", () => {
  it("opens a sheet, sends the address and the role, and closes on the way out", async () => {
    const sent: Array<[string, string, string]> = [];
    await show({
      createInvite: (async (id: string, to: string, role: string) => {
        sent.push([id, to, role]);
      }) as unknown as Api["createInvite"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    // The button is short because the row is; the sheet has the room to ask in full.
    expect(screen.getByRole("dialog").querySelector("h2")?.textContent).toBe("Invite someone");
    const field = screen.getByLabelText("Email address to invite");
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "kel@example.com" } });
    fireEvent.click(screen.getByLabelText("Watches"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(sent).toEqual([["run-1", "kel@example.com", "viewer"]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Sent to kel@example.com. The link works for seven days.");
    // Back where the press came from, so a keyboard is not left at the top.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Invite" }));
  });

  it("stays open, with what went wrong, when it did not send", async () => {
    await show({
      createInvite: (async () => {
        throw new Error("That address is not one we can reach.");
      }) as Api["createInvite"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    fireEvent.change(screen.getByLabelText("Email address to invite"), { target: { value: "kel@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("That address is not one we can reach.");
  });

  it("closes on Escape", async () => {
    await show({});
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await flush(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends nothing while the address is empty", async () => {
    await show({});
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("says nothing about copies when one copy seats the table", async () => {
    await show({}, runOf(), packWith({ redistributable: false, tablePlays: true }));
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.queryByText(/needs their own copy/)).toBeNull();
    expect((screen.getByLabelText("Plays") as HTMLInputElement).disabled).toBe(false);
  });

  it("sends a plays invitation as watches where the author said a copy each", async () => {
    const sent: Array<[string, string]> = [];
    await show(
      {
        createInvite: (async (_id: string, to: string, role: string) => {
          sent.push([to, role]);
        }) as unknown as Api["createInvite"],
      },
      runOf(),
      packWith({ redistributable: false, tablePlays: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByText(/needs their own copy/)).toBeTruthy();
    expect((screen.getByLabelText("Plays") as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Email address to invite"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(sent).toEqual([["ada@example.com", "viewer"]]);
  });
});

describe("the live link", () => {
  it("copies the link the device remembers", async () => {
    rememberLiveLink("run-1", LINK);
    await show({}, runOf({ shared: true }));

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await flush();

    expect(written).toEqual([LINK]);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  /** One press opens the run to watchers and puts the link on the clipboard. */
  it("shares and copies in the one press", async () => {
    await show({ shareRun: (async () => ({ link: LINK })) as Api["shareRun"] });

    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    await flush();

    expect(written).toEqual([LINK]);
    // The slot is the copy button from here on, and it says what just happened.
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
  });

  it("stops sharing, and says the link is dead", async () => {
    rememberLiveLink("run-1", LINK);
    const stopped: string[] = [];
    await show({ unshareRun: (async (id: string) => stopped.push(id)) as unknown as Api["unshareRun"] }, runOf({ shared: true }));

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    await flush();

    expect(stopped).toEqual(["run-1"]);
    expect(screen.queryByRole("button", { name: "Stop sharing" })).toBeNull();
    expect(screen.getByText("The link is dead; anyone holding it sees nothing now.")).toBeTruthy();
  });
});

/**
 * The address a tool dials, from a device that never minted the key.
 *
 * The server keeps a hash of the key and nothing else, so a browser that
 * did not make it cannot be handed it. The button used to go gray and
 * blame sharing. It makes a new key instead, once the cost of that has
 * been said out loud.
 */
describe("an address from a device with no key", () => {
  const shared = () => runOf({ shared: true });
  const unfinished = "Copy connection address (this device will need a new watch key)";

  it("asks, mints, remembers, and copies an address with the new key", async () => {
    reach.key = null;
    const minted: string[] = [];
    await show(
      {
        mintStreamKey: (async (kind: string) => {
          minted.push(kind);
          return { key: "fresh-key", keys: { watch: { at: 1 } } };
        }) as unknown as Api["mintStreamKey"],
      },
      shared(),
    );

    fireEvent.click(screen.getAllByRole("button", { name: unfinished })[0]!);
    await flush(1);
    expect(screen.getByRole("alertdialog").textContent).toContain("Make a new watch key?");
    expect(screen.getByRole("alertdialog").textContent).toContain("replaces the old one everywhere it is pasted");

    fireEvent.click(screen.getByRole("button", { name: "Make a new key" }));
    await flush();

    expect(minted).toEqual(["watch"]);
    expect(watchKeyHere()).toBe("fresh-key");
    expect(written.length).toBe(1);
    expect(written[0]).toContain("k=fresh-key");
    expect(written[0]).toContain("run=run-1");
  });

  it("mints nothing and copies nothing when the question is refused", async () => {
    reach.key = null;
    const minted: string[] = [];
    await show(
      {
        mintStreamKey: (async (kind: string) => {
          minted.push(kind);
          return { key: "fresh-key", keys: {} };
        }) as unknown as Api["mintStreamKey"],
      },
      shared(),
    );

    fireEvent.click(screen.getAllByRole("button", { name: unfinished })[0]!);
    await flush(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();

    expect(minted).toEqual([]);
    expect(written).toEqual([]);
    expect(watchKeyHere()).toBeNull();
  });

  /**
   * A refused mint is worth saying out loud. The press asked a question,
   * got a yes, and then nothing would have happened on screen at all.
   */
  it("says so when the server will not make one, and copies nothing", async () => {
    reach.key = null;
    await show(
      {
        mintStreamKey: (async () => {
          throw new Error("no");
        }) as unknown as Api["mintStreamKey"],
      },
      shared(),
    );

    fireEvent.click(screen.getAllByRole("button", { name: unfinished })[0]!);
    await flush(1);
    fireEvent.click(screen.getByRole("button", { name: "Make a new key" }));
    await flush();

    expect(screen.getByRole("status").textContent).toBe("Could not make a watch key.");
    expect(written).toEqual([]);
    expect(watchKeyHere()).toBeNull();
  });

  /**
   * The question closes on the press and the mint runs on past it. A
   * second press used to ask again and mint again, putting out the key
   * the first press was still copying.
   */
  it("mints once while one is in flight, and comes back when it settles", async () => {
    reach.key = null;
    const minted: string[] = [];
    let settle!: (made: { key: string; keys: Record<string, never> }) => void;
    await show(
      {
        mintStreamKey: (async (kind: string) => {
          minted.push(kind);
          return await new Promise((resolve) => {
            settle = resolve as typeof settle;
          });
        }) as unknown as Api["mintStreamKey"],
      },
      shared(),
    );

    fireEvent.click(screen.getAllByRole("button", { name: unfinished })[0]!);
    await flush(1);
    fireEvent.click(screen.getByRole("button", { name: "Make a new key" }));
    await flush(2);

    const gray = screen.getAllByRole("button", { name: unfinished });
    expect(gray.every((b) => b.hasAttribute("disabled"))).toBe(true);
    fireEvent.click(gray[0]!);
    fireEvent.click(gray[1]!);
    await flush(2);
    expect(minted).toEqual(["watch"]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    settle({ key: "fresh-key", keys: {} });
    await flush();

    expect(minted).toEqual(["watch"]);
    expect(written).toEqual([expect.stringContaining("k=fresh-key")]);
    const back = screen.getAllByRole("button", { name: "Copy connection address" });
    expect(back.every((b) => b.hasAttribute("disabled"))).toBe(false);
  });

  /** With a key in hand nothing is asked: it copies, and says so. */
  it("copies straight off where the key is here", async () => {
    const minted: string[] = [];
    await show({ mintStreamKey: (async () => minted.push("watch")) as unknown as Api["mintStreamKey"] }, shared());

    fireEvent.click(screen.getAllByRole("button", { name: "Copy connection address" })[0]!);
    await flush();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(minted).toEqual([]);
    expect(written[0]).toContain("k=watchkey");
  });
});
