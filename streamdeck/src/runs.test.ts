import { describe, expect, it } from "vitest";

import { openRuns, type RunsDeps } from "./runs.ts";

/**
 * The account's open runs, over HTTP.
 *
 * The socket's list is what a device is holding, and it arrives only while
 * the socket is up. This is what the account has, which is the question a
 * streamer setting a deck up before a stream is actually asking.
 */

const account = { apiBase: "https://runlog.example" };

const row = (over: Record<string, unknown>) => ({
  id: "s1",
  role: "owner",
  packId: "p",
  packVersion: "1",
  ownerSub: "user_1",
  seq: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function deps(over: Partial<RunsDeps> & { sessions?: unknown; status?: number } = {}): RunsDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    bearer: over.bearer ?? (async () => "tok"),
    fetch: (over.fetch ??
      (async (url: string | URL | Request) => {
        asked.push(String(url));
        return {
          ok: (over.status ?? 200) < 400,
          async json() {
            return { sessions: over.sessions ?? [] };
          },
        } as Response;
      })) as typeof fetch,
  };
}

describe("the account's open runs", () => {
  it("asks the signed-in route, with the token", async () => {
    const d = deps({ sessions: [row({})] });
    await openRuns(account, d);
    expect(d.asked).toEqual(["https://runlog.example/api/sessions"]);
  });

  it("keeps the runs the account owns and has not ended", async () => {
    const d = deps({
      sessions: [
        row({ id: "mine", name: "Thursday", packTitle: "The Long Kiln" }),
        row({ id: "over", endedAt: "2026-01-02T00:00:00.000Z" }),
        row({ id: "gone", deletedAt: "2026-01-02T00:00:00.000Z" }),
        row({ id: "theirs", role: "player" }),
      ],
    });
    expect(await openRuns(account, d)).toEqual([{ id: "mine", packId: "p", name: "Thursday", packTitle: "The Long Kiln" }]);
  });

  it("puts the one that moved most recently first", async () => {
    const d = deps({
      sessions: [row({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }), row({ id: "new", updatedAt: "2026-03-01T00:00:00.000Z" })],
    });
    expect((await openRuns(account, d))!.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("caps the list, because a picker is a short list", async () => {
    const sessions = Array.from({ length: 40 }, (_, i) => row({ id: `s${i}` }));
    expect(await openRuns(account, deps({ sessions }))).toHaveLength(20);
  });

  it("leaves out a name or a pack the run does not carry", async () => {
    // The pack id rides along, because a key set to one pack needs it to tell
    // its runs from another pack's.
    expect(await openRuns(account, deps({ sessions: [row({})] }))).toEqual([{ id: "s1", packId: "p" }]);
  });

  it("says nothing rather than nothing-at-all when it could not ask", async () => {
    // `null` and `[]` are different answers, and a picker that emptied
    // itself on a hiccup would throw away a choice somebody just made.
    expect(await openRuns(account, deps({ bearer: async () => null }))).toBe(null);
    expect(await openRuns(account, deps({ status: 500 }))).toBe(null);
    expect(
      await openRuns(account, {
        bearer: async () => "tok",
        fetch: (async () => {
          throw new Error("offline");
        }) as typeof fetch,
      }),
    ).toBe(null);
  });

  it("says nothing when the answer is not the shape it asked for", async () => {
    expect(await openRuns(account, deps({ sessions: "not a list" }))).toBe(null);
  });
});
