// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createThemeRecordFromPreset, type ThemeRecordV1 } from "@runlog/themes";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { GuestThemeImport, guestImportKey } from "./GuestThemeImport.tsx";
import { ThemeProvider, useThemes, type ThemeContextValue } from "./ThemeProvider.tsx";
import { openThemeRepository, type ThemeRepository } from "./themeStorage.ts";

/** Theme names whose save into an account's own repository should reject, for the partial-failure test. */
const FAIL_NAMES = vi.hoisted(() => new Set<string>());

vi.mock("./themeStorage.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./themeStorage.ts")>();
  return {
    ...actual,
    openThemeRepository: async (...args: Parameters<typeof actual.openThemeRepository>) => {
      const repo = await actual.openThemeRepository(...args);
      if (args[0].kind !== "account") return repo;
      // Everything but saveTheme passes straight through to the real repository instance,
      // which relies on private fields that only work when called with itself as `this`.
      return new Proxy(repo, {
        get(target, prop, receiver) {
          if (prop === "saveTheme") {
            return async (input: Parameters<ThemeRepository["saveTheme"]>[0]) => {
              if (FAIL_NAMES.has(input.record.name)) throw new Error("save failed");
              return target.saveTheme(input);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

function record(id: string, name = id): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember" });
  if (!made.ok) throw new Error("fixture");
  return made.value;
}
const signedIn = (id: string) =>
  ({ status: "signed-in", user: { id }, signOut: vi.fn(), getAccessToken: vi.fn(async () => "tok") }) as unknown as Account;

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
        <GuestThemeImport />
      </ThemeProvider>
    </AccountContext.Provider>,
  );

async function guestHas(...records: ThemeRecordV1[]) {
  const repo = await openThemeRepository({ kind: "anon" });
  for (const r of records) await repo.saveTheme({ record: r, expectedLocalRevision: null });
  repo.close();
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  FAIL_NAMES.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("offering guest themes to an account", () => {
  it("lists every guest theme ticked, imports the chosen ones as new themes, and leaves the originals", async () => {
    await guestHas(record("g1", "Dusk"), record("g2", "Dawn"));
    mount(signedIn("user_1"));
    await screen.findByRole("dialog", { name: "Add your themes to this account?" });
    const dusk = screen.getByRole("checkbox", { name: "Dusk" }) as HTMLInputElement;
    const dawn = screen.getByRole("checkbox", { name: "Dawn" }) as HTMLInputElement;
    expect(dusk.checked && dawn.checked).toBe(true);
    fireEvent.click(dawn);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import" })));
    await waitFor(() => expect(current.library.map((r) => r.record.name)).toEqual(["Dusk"]));
    expect(current.library[0]!.id).not.toBe("g1");
    expect(current.library[0]!.record.contentRevision).toBe(1);
    const guest = await openThemeRepository({ kind: "anon" });
    expect((await guest.listLibrary()).map((r) => r.id)).toEqual(["g1", "g2"]);
    guest.close();
    expect(JSON.parse(localStorage.getItem(guestImportKey("user_1"))!)).toEqual({ schemaVersion: 1, offered: ["g1", "g2"] });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks once: Not now imports nothing, and only a later new guest theme is offered", async () => {
    await guestHas(record("g1", "Dusk"));
    const first = mount(signedIn("user_1"));
    await screen.findByRole("dialog");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not now" })));
    expect(current.library).toEqual([]);
    first.unmount();
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    await guestHas(record("g3", "Noon"));
    mount(signedIn("user_1"));
    await screen.findByRole("dialog");
    expect(screen.getAllByRole("checkbox").map((c) => (c.closest("label")?.textContent ?? "").trim())).toEqual(["Noon"]);
  });

  it("does not ask a guest, and does not ask when there is nothing to offer", async () => {
    await guestHas(record("g1"));
    mount({ status: "signed-out", signIn: vi.fn() } as unknown as Account);
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    localStorage.clear();
    vi.stubGlobal("indexedDB", new IDBFactory());
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits behind another dialog", async () => {
    await guestHas(record("g1", "Dusk"));
    const gate = document.createElement("section");
    gate.setAttribute("aria-modal", "true");
    document.body.append(gate);
    mount(signedIn("user_1"));
    await waitFor(() => expect(current.status).toBe("ready"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog", { name: "Add your themes to this account?" })).toBeNull();
    gate.remove();
    await screen.findByRole("dialog", { name: "Add your themes to this account?" });
  });

  it("closes and imports nothing into the next account when the account changes", async () => {
    await guestHas(record("g1", "Dusk"));
    const view = mount(signedIn("user_1"));
    await screen.findByRole("dialog");
    view.rerender(
      <AccountContext.Provider value={signedIn("user_2")}>
        <ThemeProvider>
          <Probe />
          <GuestThemeImport />
        </ThemeProvider>
      </AccountContext.Provider>,
    );
    await waitFor(() => expect(current.status).toBe("ready"));
    expect(current.library).toEqual([]);
  });

  it("marks the succeeded and unticked themes as asked about even when one save fails, and offers only the failed one again", async () => {
    FAIL_NAMES.add("Dusk");
    await guestHas(record("g1", "Dusk"), record("g2", "Dawn"), record("g3", "Noon"));
    mount(signedIn("user_1"));
    await screen.findByRole("dialog", { name: "Add your themes to this account?" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Noon" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import" })));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("Some themes could not be imported. They are still on this device.");
    expect(screen.getAllByRole("checkbox").map((c) => (c.closest("label")?.textContent ?? "").trim())).toEqual(["Dusk"]);
    await waitFor(() => expect(current.library.map((r) => r.record.name)).toEqual(["Dawn"]));
    expect(JSON.parse(localStorage.getItem(guestImportKey("user_1"))!)).toEqual({ schemaVersion: 1, offered: ["g2", "g3"] });
  });
});
