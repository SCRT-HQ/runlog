// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThemeRecordFromPreset, presentationSnapshotKey, resolveThemeRecord, type ThemeRecordV1 } from "@runlog/themes";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { APPEARANCE_KEY, snapshotForBuiltin } from "./appearance.ts";
import type { SavedThemeRow, ThemeRepository } from "./themeStorage.ts";
import { setDeviceAppearance } from "./useAppearance.ts";

const openRepository = vi.hoisted(() => vi.fn());
vi.mock("./themeStorage.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./themeStorage.ts")>()),
  openThemeRepository: openRepository,
}));

import { ThemeProvider, useThemes, type ThemeContextValue } from "./ThemeProvider.tsx";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function record(id: string, name = id, contentRevision = 1): ThemeRecordV1 {
  const made = createThemeRecordFromPreset({ id, name, presetId: "ember", contentRevision });
  if (!made.ok) throw new Error("test record failed");
  return made.value;
}

function row(id: string, name = id, localRevision = 1, contentRevision = 1): SavedThemeRow {
  return Object.freeze({ kind: "saved", id, localRevision, record: record(id, name, contentRevision) });
}

function repository(scopeKey: string, library: readonly SavedThemeRow[] = []): ThemeRepository {
  return {
    scopeKey,
    listLibrary: vi.fn().mockResolvedValue(library),
    loadTheme: vi.fn().mockImplementation(async (id: string) => library.find((item) => item.id === id) ?? null),
    saveTheme: vi.fn(),
    deleteTheme: vi.fn(),
    listDrafts: vi.fn().mockResolvedValue([]),
    loadDraft: vi.fn().mockResolvedValue(null),
    saveDraft: vi.fn(),
    deleteDraft: vi.fn(),
    finalizeDraft: vi.fn(),
    loadAppliedSource: vi.fn().mockResolvedValue(null),
    saveAppliedSource: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
}

const local: Account = { status: "local" };
const checking: Account = { status: "checking", signIn: vi.fn() };
const signedIn = (id: string) => ({ status: "signed-in", user: { id }, signOut: vi.fn(), getAccessToken: vi.fn() }) as unknown as Account;

let current: ThemeContextValue;
function Probe() {
  current = useThemes();
  return (
    <div>
      <output data-testid="status">{current.status}</output>
      <output data-testid="scope">{current.scopeKey ?? "none"}</output>
      <output data-testid="names">{current.library.map(({ record: value }) => value.name).join(",")}</output>
      <output data-testid="source">{current.sourceRemoved ? "removed" : (current.appliedSource?.id ?? "none")}</output>
      <output data-testid="problem">{current.problem ?? "none"}</output>
    </div>
  );
}

function Providers({ account, children }: { account: Account; children?: ReactNode }) {
  return (
    <AccountContext.Provider value={account}>
      <ThemeProvider>{children ?? <Probe />}</ThemeProvider>
    </AccountContext.Provider>
  );
}

beforeEach(() => {
  openRepository.mockReset();
  localStorage.clear();
  setDeviceAppearance({ schemaVersion: 1, mode: "system" });
  document.documentElement.removeAttribute("data-widget");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-widget");
  for (const property of [...document.documentElement.style]) {
    if (property.startsWith("--") || property === "color-scheme") document.documentElement.style.removeProperty(property);
  }
});

describe("account-scoped theme provider", () => {
  it("is safely unavailable without a provider and never opens or fakes repository writes", async () => {
    render(<Probe />);

    expect(screen.getByTestId("status").textContent).toBe("unavailable");
    await expect(current.saveTheme({ record: record("standalone"), expectedLocalRevision: null })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(openRepository).not.toHaveBeenCalled();
  });

  it("hides the prior account synchronously while checking and before the next repository settles", async () => {
    const accountA = repository("runlog:u:a:themes", [row("a-theme", "Account A")]);
    const accountB = repository("runlog:u:b:themes", [row("b-theme", "Account B")]);
    const openingB = deferred<ThemeRepository>();
    openRepository.mockImplementation(({ id }: { id?: string }) => (id === "a" ? Promise.resolve(accountA) : openingB.promise));
    const page = render(<Providers account={signedIn("a")} />);
    await waitFor(() => expect(screen.getByTestId("names").textContent).toBe("Account A"));

    page.rerender(<Providers account={checking} />);
    expect(screen.getByTestId("status").textContent).toBe("checking");
    expect(screen.getByTestId("names").textContent).toBe("");
    expect(screen.getByTestId("scope").textContent).toBe("none");

    page.rerender(<Providers account={signedIn("b")} />);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(screen.getByTestId("names").textContent).toBe("");
    openingB.resolve(accountB);
    await waitFor(() => expect(screen.getByTestId("names").textContent).toBe("Account B"));
    expect(accountA.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale mutation completion without exposing it in the new scope", async () => {
    const savedA = deferred<ReturnType<ThemeRepository["saveTheme"]> extends Promise<infer T> ? T : never>();
    const accountA = repository("runlog:u:a:themes", [row("a-theme", "Account A")]);
    accountA.saveTheme = vi.fn(() => savedA.promise);
    const accountB = repository("runlog:u:b:themes", []);
    openRepository.mockImplementation(({ id }: { id?: string }) => Promise.resolve(id === "a" ? accountA : accountB));
    const page = render(<Providers account={signedIn("a")} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

    const pending = current.saveTheme({ record: record("new-theme", "From A"), expectedLocalRevision: null });
    page.rerender(<Providers account={signedIn("b")} />);
    savedA.resolve({ ok: true, value: row("new-theme", "From A") });

    await expect(pending).rejects.toMatchObject({ code: "closed" });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("names").textContent).toBe("");
  });

  it("saves without applying, then applies an exact immutable snapshot that later saves do not change", async () => {
    const first = row("custom", "First", 3, 4);
    const saved = row("custom", "Modified", 4, 5);
    const later = row("custom", "Later", 5, 6);
    const repo = repository("runlog:themes", [first]);
    repo.saveTheme = vi.fn().mockResolvedValueOnce({ ok: true, value: saved }).mockResolvedValueOnce({ ok: true, value: later });
    repo.loadTheme = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(saved);
    openRepository.mockResolvedValue(repo);
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    const rootBefore = document.documentElement.style.cssText;
    const storedBefore = localStorage.getItem(APPEARANCE_KEY);

    const committed = await current.saveTheme({ record: saved.record, expectedLocalRevision: 3 });
    expect(committed).toEqual({ ok: true, value: saved });
    expect(document.documentElement.style.cssText).toBe(rootBefore);
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(storedBefore);
    expect(repo.saveTheme).toHaveBeenNthCalledWith(1, { record: saved.record, expectedLocalRevision: 3 });

    await act(() => current.applySaved("custom", 4));
    const appliedJson = localStorage.getItem(APPEARANCE_KEY);
    const resolved = resolveThemeRecord(saved.record);
    expect(resolved.ok).toBe(true);
    expect(JSON.parse(appliedJson!)).toEqual({ schemaVersion: 1, mode: "snapshot", snapshot: resolved.ok ? resolved.value : null });

    await current.saveTheme({ record: later.record, expectedLocalRevision: 4 });
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe(appliedJson);
  });

  it("returns the repository's stale CAS conflict exactly without retrying or optimistically upserting", async () => {
    const first = row("custom", "First", 2, 2);
    const attempted = record("custom", "Attempted", 2);
    const newer = row("custom", "Newer elsewhere", 3, 3);
    const conflict = Object.freeze({ ok: false, reason: "conflict", current: newer } as const);
    const repo = repository("runlog:themes", [first]);
    repo.loadTheme = vi.fn().mockResolvedValue(first);
    repo.saveTheme = vi.fn().mockResolvedValue(conflict);
    openRepository.mockResolvedValue(repo);
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("names").textContent).toBe("First"));

    const result = await current.saveTheme({ record: attempted, expectedLocalRevision: 2 });

    expect(result).toBe(conflict);
    expect(repo.saveTheme).toHaveBeenCalledTimes(1);
    expect(repo.saveTheme).toHaveBeenCalledWith({ record: attempted, expectedLocalRevision: 2 });
    expect(screen.getByTestId("names").textContent).toBe("First");
  });

  it("keeps applied values and exposes a warning when source metadata cannot be saved", async () => {
    const saved = row("custom", "Custom", 2, 2);
    const repo = repository("runlog:themes", [saved]);
    repo.loadTheme = vi.fn().mockResolvedValue(saved);
    repo.saveAppliedSource = vi.fn().mockRejectedValue(new DOMException("denied", "SecurityError"));
    openRepository.mockResolvedValue(repo);
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

    await act(() => current.applySaved("custom", 2));

    expect(current.applied.mode).toBe("snapshot");
    expect(current.appliedSource).toBeNull();
    expect(screen.getByTestId("problem").textContent).not.toBe("none");
    expect(localStorage.getItem(APPEARANCE_KEY)).not.toBeNull();
  });

  it("retains an applied snapshot and marks its source removed after deletion", async () => {
    const saved = row("custom", "Custom", 2, 2);
    const resolved = resolveThemeRecord(saved.record);
    if (!resolved.ok) throw new Error("test snapshot failed");
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: resolved.value });
    const repo = repository("runlog:themes", [saved]);
    repo.loadAppliedSource = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: saved.id,
      localRevision: saved.localRevision,
      snapshotKey: presentationSnapshotKey(resolved.value),
    });
    repo.deleteTheme = vi.fn().mockResolvedValue({ ok: true, value: { kind: "deleted", id: saved.id, localRevision: 3 } });
    openRepository.mockResolvedValue(repo);
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("source").textContent).toBe("custom"));

    await act(() => current.deleteTheme({ id: "custom", expectedLocalRevision: 2 }));

    expect(current.applied.mode).toBe("snapshot");
    expect(screen.getByTestId("source").textContent).toBe("removed");
  });

  it("hides source metadata immediately when another presentation-only update changes the snapshot", async () => {
    const saved = row("custom", "Custom", 2, 2);
    const resolved = resolveThemeRecord(saved.record);
    if (!resolved.ok) throw new Error("test snapshot failed");
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: resolved.value });
    const repo = repository("runlog:themes", [saved]);
    repo.loadAppliedSource = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: saved.id,
      localRevision: saved.localRevision,
      snapshotKey: presentationSnapshotKey(resolved.value),
    });
    openRepository.mockResolvedValue(repo);
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("source").textContent).toBe("custom"));

    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "system" }));

    expect(screen.getByTestId("source").textContent).toBe("none");
  });

  it("closes StrictMode repository handles and reports opening failures as unavailable", async () => {
    const opened = [repository("runlog:themes"), repository("runlog:themes")];
    const repos = [...opened];
    openRepository.mockImplementation(() => Promise.resolve(repos.shift()!));
    const page = render(
      <StrictMode>
        <Providers account={local} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    page.unmount();
    expect(repos).toHaveLength(0);
    expect(opened.every(({ close }) => vi.mocked(close).mock.calls.length === 1)).toBe(true);

    openRepository.mockRejectedValue(new DOMException("denied", "SecurityError"));
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unavailable"));
    expect(screen.getByTestId("names").textContent).toBe("");
  });

  it("restores appearance without a repository and Retry safely reopens storage after an opening failure", async () => {
    openRepository.mockRejectedValueOnce(new DOMException("denied", "SecurityError"));
    render(<Providers account={local} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unavailable"));

    await act(() => current.applyBuiltin("daylight"));

    expect(current.applied).toEqual({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("daylight") });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual(current.applied);
    expect(screen.getByTestId("problem").textContent).toContain("Appearance applied");

    const reopened = repository("runlog:themes", [row("recovered", "Recovered")]);
    openRepository.mockResolvedValueOnce(reopened);
    const firstRetry = current.reload();
    const joinedRetry = current.reload();
    await act(() => Promise.all([firstRetry, joinedRetry]));

    expect(openRepository).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("names").textContent).toBe("Recovered");
    expect(screen.getByTestId("problem").textContent).toBe("none");
  });
});
