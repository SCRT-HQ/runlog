import { describe, expect, it, vi } from "vitest";
import { createApi } from "./client.ts";

/** The fetch the client was handed, as a list of what it asked for. */
function fetching(answer: unknown, status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  });
  return { calls, impl: impl as unknown as typeof fetch };
}

const api = (impl: typeof fetch) => createApi("https://runlog.test/api", async () => "t", impl);

describe("watch parties, from the app", () => {
  it("reads the run's parties and the servers to pick from", async () => {
    const { calls, impl } = fetching({ parties: [], servers: [{ guildId: "g1", name: "The Kiln Room", watchParties: "off" }] });
    const out = await api(impl).parties("01RUN");
    expect(calls[0]?.url).toContain("/sessions/01RUN/parties");
    expect(out.servers[0]?.name).toBe("The Kiln Room");
  });

  it("sends the link this device holds when it opens one", async () => {
    const { calls, impl } = fetching({
      party: { guildId: "g1", threadId: "t1", threadUrl: "https://discord.com/channels/g1/t1", openedAt: "2026-09-16T10:00:00.000Z" },
    });
    const party = await api(impl).openParty("01RUN", "g1", "https://runlog.test/r/01RUN?t=tok");
    expect(calls[0]?.body).toEqual({ guildId: "g1", link: "https://runlog.test/r/01RUN?t=tok" });
    expect(party.threadUrl).toBe("https://discord.com/channels/g1/t1");
  });

  it("throws what the server said when it would not", async () => {
    const { impl } = fetching({ error: "Share the run first: a watch party carries its live link." }, 422);
    await expect(api(impl).openParty("01RUN", "g1", null)).rejects.toThrow("Share the run first");
  });

  it("closes one", async () => {
    const { calls, impl } = fetching({ closed: true });
    await api(impl).endParty("01RUN", "g1");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/sessions/01RUN/parties/g1");
  });
});

describe("what the snapshot carries beside itself", () => {
  it("sends the run's live link and its first mark when it is given them", async () => {
    const { calls, impl } = fetching({ kept: true });
    await api(impl).putSnapshot("01RUN", { v: 1 }, { link: "https://runlog.test/r/01RUN?t=tok", first: true });
    expect(calls[0]?.body).toEqual({ snapshot: { v: 1 }, link: "https://runlog.test/r/01RUN?t=tok", first: true });
  });

  it("sends the snapshot alone when it is not", async () => {
    const { calls, impl } = fetching({ kept: true });
    await api(impl).putSnapshot("01RUN", { v: 1 });
    expect(calls[0]?.body).toEqual({ snapshot: { v: 1 } });
  });
});
