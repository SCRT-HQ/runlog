// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { memoryThemeApi, memoryThemeServer, type MemoryThemeServer } from "./sync/testing/memoryThemeApi.ts";

const hooks = vi.hoisted(() => ({
  factory: null as unknown as IDBFactory,
  server: null as unknown as MemoryThemeServer,
  apiFor: vi.fn(),
  applied: vi.fn(),
}));
vi.mock("../sync/config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/config.ts")>()),
  apiBase: () => "https://runlog.test/api/",
}));
vi.mock("../sync/themeApi.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/themeApi.ts")>()),
  createThemeApi: () => hooks.apiFor(),
}));
vi.mock("./themeStorage.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./themeStorage.ts")>();
  return {
    ...real,
    openThemeRepository: (who: Parameters<typeof real.openThemeRepository>[0]) => real.openThemeRepository(who, hooks.factory),
  };
});
vi.mock("./useAppearance.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./useAppearance.ts")>();
  hooks.applied.mockImplementation(real.setDeviceAppearance);
  return { ...real, setDeviceAppearance: hooks.applied };
});

import { setSyncEnabled } from "../sync/config.ts";
import { ThemeProvider, useThemes, type ThemeContextValue } from "./ThemeProvider.tsx";

function record(id: string, name = id): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}
const signedIn = (id: string) =>
  ({ status: "signed-in", user: { id }, signOut: vi.fn(), getAccessToken: vi.fn(async () => "tok") }) as unknown as Account;
const guest = { status: "anonymous", signIn: vi.fn(), signUp: vi.fn() } as unknown as Account;

/** Real time for a pass that would have started to reach the server; the poll's interval stays faked. */
const settle = () => new Promise((r) => setTimeout(r, 200));

let current: ThemeContextValue;
function Probe() {
  current = useThemes();
  return null;
}
const mount = (account: Account) =>
  render(
    <AccountContext.Provider value={account}>
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    </AccountContext.Provider>,
  );

beforeEach(() => {
  hooks.factory = new IDBFactory();
  hooks.server = memoryThemeServer();
  hooks.apiFor.mockReset();
  hooks.apiFor.mockImplementation(() => memoryThemeApi(hooks.server, "user_1"));
  hooks.applied.mockClear();
  setSyncEnabled(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("theme sync in the provider", () => {
  it("pushes a saved theme and reports it synced, leaving the applied look alone", async () => {
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(current.sync.mode).toBe("on");
    await act(async () => {
      await current.saveTheme({ record: record("t1"), expectedLocalRevision: null });
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(current.sync.items.get("t1")).toEqual({ kind: "synced" }));
    expect(hooks.server.rows.has("user_1/t1")).toBe(true);
    expect(hooks.applied).not.toHaveBeenCalled();
  });

  it("does nothing with the switch off, and starts when it is turned on", async () => {
    setSyncEnabled(false);
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(current.sync.mode).toBe("off");
    await act(async () => {
      await current.saveTheme({ record: record("t1"), expectedLocalRevision: null });
    });
    expect(hooks.server.rows.size).toBe(0);
    act(() => setSyncEnabled(true));
    await waitFor(() => expect(hooks.server.rows.has("user_1/t1")).toBe(true));
  });

  it("never talks to the server for a guest", async () => {
    mount(guest);
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(current.sync.mode).toBe("device");
    await act(async () => {
      await current.saveTheme({ record: record("t1"), expectedLocalRevision: null });
      window.dispatchEvent(new Event("focus"));
    });
    expect(hooks.apiFor).not.toHaveBeenCalled();
  });

  it("drops a late answer for the account that signed out and shows none of its themes to the next", async () => {
    let release!: () => void;
    hooks.server.script.push({ hold: new Promise<void>((r) => (release = r)) });
    const view = mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    await act(async () => {
      await current.saveTheme({ record: record("t1", "A's theme"), expectedLocalRevision: null });
      window.dispatchEvent(new Event("focus"));
    });
    hooks.apiFor.mockImplementation(() => memoryThemeApi(hooks.server, "user_2"));
    view.rerender(
      <AccountContext.Provider value={signedIn("user_2")}>
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      </AccountContext.Provider>,
    );
    expect(current.library).toEqual([]);
    await act(async () => release());
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(current.library).toEqual([]);
    expect(current.sync.items.has("t1")).toBe(false);
  });

  it("pulls every 30 seconds while the library is watched, without changing the applied look", async () => {
    // Only the poll's interval is faked; vi.waitFor keeps real timers, which Testing Library's waitFor does not.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mount(signedIn("user_1"));
    await vi.waitFor(() => expect(current.status).toBe("ready"));
    await act(async () => {
      await current.saveTheme({ record: record("t1", "Worn"), expectedLocalRevision: null });
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(current.sync.items.get("t1")).toEqual({ kind: "synced" }));
    const worn = current.library.find((r) => r.id === "t1")!;
    await act(async () => current.applySaved("t1", worn.localRevision));
    expect(current.appliedSource?.id).toBe("t1");
    hooks.applied.mockClear();

    let stop!: () => void;
    const beforeWatch = hooks.server.lists;
    act(() => {
      stop = current.sync.watchLibrary();
    });
    // Watching pulls once at once; let that settle so only the interval can find the next change.
    await vi.waitFor(() => expect(hooks.server.lists).toBeGreaterThan(beforeWatch));
    await vi.waitFor(() => expect(current.sync.phase).toBe("idle"));
    await memoryThemeApi(hooks.server, "user_1").putTheme({
      record: record("t9", "From elsewhere"),
      base: null,
      key: "key-0000000000000099",
    });
    await settle();
    expect(current.library.map((r) => r.record.name)).not.toContain("From elsewhere");
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await vi.waitFor(() => expect(current.library.map((r) => r.record.name)).toContain("From elsewhere"));
    expect(current.appliedSource?.id).toBe("t1");
    expect(hooks.applied).not.toHaveBeenCalled();
    stop();
  });

  it("does not poll while nothing watches the library, or while the tab is hidden", async () => {
    // Only the poll's interval is faked; vi.waitFor keeps real timers, which Testing Library's waitFor does not.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mount(signedIn("user_1"));
    await vi.waitFor(() => expect(current.status).toBe("ready"));
    await vi.waitFor(() => expect(hooks.server.lists).toBeGreaterThan(0));
    await vi.waitFor(() => expect(current.sync.phase).toBe("idle"));
    const unwatched = hooks.server.lists;
    await act(async () => {
      vi.advanceTimersByTime(90_000);
      await settle();
    });
    expect(hooks.server.lists).toBe(unwatched);

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      let stop!: () => void;
      act(() => {
        stop = current.sync.watchLibrary();
      });
      await vi.waitFor(() => expect(hooks.server.lists).toBeGreaterThan(unwatched));
      await vi.waitFor(() => expect(current.sync.phase).toBe("idle"));
      const hidden = hooks.server.lists;
      await act(async () => {
        vi.advanceTimersByTime(90_000);
        await settle();
      });
      expect(hooks.server.lists).toBe(hidden);
      stop();
    } finally {
      visibility.mockRestore();
    }
  });

  it("keeps an open draft when a pull changes the theme under it", async () => {
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    await act(async () => {
      await current.saveTheme({ record: record("t1", "Base"), expectedLocalRevision: null });
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(current.sync.items.get("t1")).toEqual({ kind: "synced" }));
    const before = current.library.find((r) => r.id === "t1")!;
    const draft = {
      schemaVersion: 1 as const,
      id: "draft_1",
      sourceThemeId: "t1",
      baseLocalRevision: before.localRevision,
      record: record("t1", "Editing"),
      rawName: "",
      rawColors: {},
    };
    await act(async () => {
      await current.saveDraft({ draft, expectedLocalRevision: null });
    });
    await memoryThemeApi(hooks.server, "user_1").putTheme({ record: record("t1", "Elsewhere"), base: 1, key: "key-0000000000000098" });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(current.library.find((r) => r.id === "t1")?.record.name).toBe("Elsewhere"));
    const stored = current.drafts.find((d) => d.id === "draft_1")!;
    const result = await current.finalizeDraft({
      record: record("t1", "Editing"),
      expectedLocalRevision: before.localRevision,
      draftId: "draft_1",
      expectedDraftRevision: stored.localRevision,
    });
    expect(result.ok).toBe(false);
    expect(current.drafts.some((d) => d.id === "draft_1")).toBe(true);
  });

  it("tells other tabs only that something changed", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: ((e: MessageEvent) => void) | null = null;
        postMessage(message: unknown) {
          posted.push(message);
        }
        close() {}
      },
    );
    try {
      mount(signedIn("user_1"));
      await waitFor(() => expect(current.status).toBe("ready"));
      await memoryThemeApi(hooks.server, "user_1").putTheme({
        record: record("t9", "Secret Palette"),
        base: null,
        key: "key-0000000000000097",
      });
      await act(async () => window.dispatchEvent(new Event("focus")));
      await waitFor(() => expect(posted.length).toBeGreaterThan(0));
      expect(posted.every((m) => JSON.stringify(m) === '{"t":"themes-changed"}')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
