// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api, ApiKey, Claim } from "../sync/client.ts";
import { DeveloperKeysPage } from "./DeveloperKeysPage.tsx";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("developer keys", () => {
  it("lets an account with no publisher create its first developer key", async () => {
    const source = {
      listKeys: vi.fn(async () => []),
      listClaims: vi.fn(async () => []),
      createKey: vi.fn(async () => ({
        key: { id: "k1", name: "CI", prefix: "rl_test", scope: "release", createdAt: "2026-09-18" },
        secret: "rl_secret",
      })),
    } as unknown as Api;

    render(<DeveloperKeysPage api={source} />);

    expect(await screen.findByRole("heading", { name: "Developer keys" })).toBeTruthy();
    expect(await screen.findByText(/RUNLOG_API_KEY/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name for the new key"), { target: { value: "CI" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    await screen.findByText(/copy it now/i);
    expect(source.createKey).toHaveBeenCalledWith("CI", "release");
  });

  it("shows a failed combined load and retries instead of fabricating empty lists", async () => {
    let attempt = 0;
    const source = {
      listKeys: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("offline");
        return [];
      }),
      listClaims: vi.fn(async () => []),
    } as unknown as Api;

    render(<DeveloperKeysPage api={source} />);

    expect(await screen.findByText(/developer keys could not be loaded/i)).toBeTruthy();
    expect(screen.queryByLabelText("Name for the new key")).toBeNull();
    expect(screen.queryByText(/None yet/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Name for the new key")).toBeTruthy();
    expect(source.listKeys).toHaveBeenCalledTimes(2);
    expect(source.listClaims).toHaveBeenCalledTimes(2);
  });

  it("does not show late results from a previous API owner", async () => {
    const oldKeys = deferred<ApiKey[]>();
    const oldClaims = deferred<Claim[]>();
    const oldApi = {
      listKeys: vi.fn(() => oldKeys.promise),
      listClaims: vi.fn(() => oldClaims.promise),
    } as unknown as Api;
    const newApi = {
      listKeys: vi.fn(async () => [{ id: "new", name: "New owner CI", prefix: "rl_new", scope: "release", createdAt: "2026-09-18" }]),
      listClaims: vi.fn(async () => []),
    } as unknown as Api;
    const view = render(<DeveloperKeysPage api={oldApi} />);

    view.rerender(<DeveloperKeysPage api={newApi} />);
    expect(await screen.findByText("New owner CI")).toBeTruthy();

    oldKeys.resolve([{ id: "old", name: "Old owner CI", prefix: "rl_old", scope: "release", createdAt: "2026-09-17" }]);
    oldClaims.resolve([]);
    await waitFor(() => expect(screen.queryByText("Old owner CI")).toBeNull());
  });
});
