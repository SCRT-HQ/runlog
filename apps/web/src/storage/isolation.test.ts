// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { Who } from "./who.ts";

/**
 * The leak, held shut.
 *
 * What happened: the app was opened on a phone that had never signed in,
 * and it showed packs that had been synced down to a signed-in browser.
 * One database name for everybody, nothing cleared on sign out, and every
 * reader reading whatever was there.
 *
 * These run against a real IndexedDB implementation rather than a stand-
 * in, because the claim is about databases and a mock of a database
 * proves nothing about them.
 */

/**
 * Storage as it is for one person, from a clean module registry.
 *
 * Both modules have to come from the same pass: `db.ts` reads who is here
 * from its own copy of `who.ts`, and telling a different copy would leave
 * it waiting for an answer that never arrives. That is also what happens
 * in the app, in the only way it can: an identity change comes with a
 * navigation, which loads both again.
 */
async function storageFor(who: Who) {
  vi.resetModules();
  const identity = (await import("./who.ts")) as typeof import("./who.ts");
  identity.whoIsHere(who);
  return (await import("./db.ts")) as typeof import("./db.ts");
}

const pack = (id: string) => ({
  id,
  title: id,
  version: "1",
  source: "schemaVersion: 1",
  format: "yaml" as const,
  filename: `${id}.yaml`,
  importedAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
});

beforeEach(() => vi.resetModules());
afterEach(() => vi.resetModules());

/*
 * Every test gets its own accounts.
 *
 * One IndexedDB stands behind the whole file, as one browser stands
 * behind a whole afternoon, so an id reused between tests is the same
 * shelf carried from one to the next. Which is correct, and is not what
 * any of these are trying to say.
 */
let n = 0;
const someone = (): Who => ({ kind: "account", id: `user_${(n += 1)}` });

describe("one browser, two people", () => {
  it("does not show one account's packs to the next", async () => {
    const a = await storageFor(someone());
    await a.savePack(pack("com.example.private"));
    expect((await a.listPacks()).map((p) => p.id)).toEqual(["com.example.private"]);

    // The same browser, a different account.
    const b = await storageFor(someone());
    expect(await b.listPacks()).toEqual([]);
  });

  it("does not show a signed-in account's packs to somebody signed out", async () => {
    // This is the one that was reported: a phone that had never signed
    // in, showing what a signed-in browser had synced down.
    const signedIn = await storageFor(someone());
    await signedIn.savePack(pack("com.example.private"));

    const signedOut = await storageFor({ kind: "anon" });
    expect(await signedOut.listPacks()).toEqual([]);
  });

  it("gives the account its own back when it returns", async () => {
    const them = someone();
    const first = await storageFor(them);
    await first.savePack(pack("com.example.mine"));

    const between = await storageFor({ kind: "anon" });
    await between.savePack(pack("com.example.borrowed"));

    const back = await storageFor(them);
    // Theirs, and only theirs: what was added while signed out stays
    // where it was added.
    expect((await back.listPacks()).map((p) => p.id)).toEqual(["com.example.mine"]);
  });

  it("keeps runs apart too, not only packs", async () => {
    const a = await storageFor(someone());
    await a.saveRun({ runId: "r1", packId: "com.example.private", packVersion: "1", events: [], updatedAt: "2026-09-14T00:00:00Z" });
    expect((await a.runsFor("com.example.private")).map((r) => r.runId)).toEqual(["r1"]);

    const anon = await storageFor({ kind: "anon" });
    expect(await anon.runsFor("com.example.private")).toEqual([]);
  });
});
