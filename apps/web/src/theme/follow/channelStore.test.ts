import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openLookChannelStore, parseLocalLookChannel, type LocalLookChannel } from "./channelStore.ts";

const channel: LocalLookChannel = {
  schemaVersion: 1,
  id: "lk_AAAAAAAAAAAAAAAA",
  secret: "s".repeat(43),
  readKey: "r".repeat(32),
  revision: 2,
  publishedKey: '{"schemaVersion":1}',
};

describe("this device's theme link record", () => {
  it("keeps the record per account, in a database of its own", async () => {
    const factory = new IDBFactory();
    const mine = await openLookChannelStore({ kind: "account", id: "user_1" }, factory);
    const theirs = await openLookChannelStore({ kind: "account", id: "user_2" }, factory);
    await mine.save(channel);
    expect(await mine.load()).toEqual(channel);
    expect(await theirs.load()).toBeNull();
    const names = (await factory.databases()).map((d) => d.name).sort();
    expect(names).toEqual(["runlog:u:user_1:look", "runlog:u:user_2:look"]);
    await mine.clear();
    expect(await mine.load()).toBeNull();
    mine.close();
    theirs.close();
  });

  it("opens nothing for a guest or a copy with no accounts", async () => {
    await expect(openLookChannelStore({ kind: "anon" }, new IDBFactory())).rejects.toThrow();
    await expect(openLookChannelStore({ kind: "local" }, new IDBFactory())).rejects.toThrow();
  });

  it("reads back only a record of the right shape", () => {
    expect(parseLocalLookChannel(channel)).toEqual(channel);
    expect(parseLocalLookChannel({ ...channel, readKey: null, publishedKey: null })).not.toBeNull();
    expect(parseLocalLookChannel({ ...channel, secret: "short" })).toBeNull();
    expect(parseLocalLookChannel({ ...channel, id: "public" })).toBeNull();
    expect(parseLocalLookChannel({ ...channel, revision: -1 })).toBeNull();
    expect(parseLocalLookChannel({ ...channel, owner: "user_1" })).toBeNull();
  });

  it("keeps the flag that another device holds the link, and only as true", () => {
    expect(parseLocalLookChannel({ ...channel, elsewhere: true })).toEqual({ ...channel, elsewhere: true });
    expect(parseLocalLookChannel({ ...channel, elsewhere: false })).toBeNull();
  });

  it("changes the record in one step, from what is stored now", async () => {
    const factory = new IDBFactory();
    const one = await openLookChannelStore({ kind: "account", id: "user_1" }, factory);
    const two = await openLookChannelStore({ kind: "account", id: "user_1" }, factory);
    await one.save(channel);
    await two.update((stored) => (stored ? { ...stored, readKey: "q".repeat(32) } : undefined));
    expect(await one.update((stored) => (stored ? { ...stored, revision: 3 } : undefined))).toEqual({
      written: true,
      value: { ...channel, readKey: "q".repeat(32), revision: 3 },
    });
    expect(await one.update(() => undefined)).toMatchObject({ written: false, value: { revision: 3 } });
    await expect(one.update((stored) => (stored ? { ...stored, secret: "short" } : undefined))).rejects.toThrow(/does not read/);
    expect(await two.load()).toMatchObject({ revision: 3 });
    expect(await two.update(() => null)).toEqual({ written: true, value: null });
    expect(await one.load()).toBeNull();
    one.close();
    two.close();
  });

  it("refuses to save a record that would not read back", async () => {
    const store = await openLookChannelStore({ kind: "account", id: "user_1" }, new IDBFactory());
    await expect(store.save({ ...channel, secret: "short" })).rejects.toThrow();
    store.close();
  });
});
