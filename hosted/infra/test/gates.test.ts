import { describe, expect, it } from "vitest";
import { gateReader, GATE_SLUGS } from "../lib/handlers/gates";
import type { WorkOSLike } from "../lib/handlers/workos";

/** A WorkOS that answers flags only, from a table a test fills. */
function flagsOnly(table: Record<string, { enabled: boolean; defaultValue: boolean } | null | Error>, calls: string[] = []): WorkOSLike {
  const never = () => Promise.reject(new Error("not this test"));
  return {
    createOrganization: never,
    addMember: never,
    listMembers: never,
    membershipsOf: never,
    removeMember: never,
    listInvitations: never,
    invite: never,
    revokeInvitation: never,
    invitationsBy: never,
    async flag(slug) {
      calls.push(slug);
      const found = table[slug];
      if (found instanceof Error) throw found;
      return found ?? null;
    },
  };
}

describe("release gates", () => {
  it("opens a gate only for a flag that is on for everyone, and asks once a minute", async () => {
    const calls: string[] = [];
    let at = 0;
    const warned: string[] = [];
    const workos = flagsOnly({ [GATE_SLUGS.servers]: { enabled: true, defaultValue: true }, [GATE_SLUGS.publishers]: { enabled: true, defaultValue: false } }, calls);
    const gates = gateReader(async () => workos, { now: () => at, warn: (m) => warned.push(m) });
    expect(await gates()).toEqual({ servers: true, publishers: false });
    expect(calls).toEqual([GATE_SLUGS.servers, GATE_SLUGS.publishers]);
    // Within the minute the answer is remembered; after it, asked again.
    at = 30_000;
    expect(await gates()).toEqual({ servers: true, publishers: false });
    expect(calls).toHaveLength(2);
    at = 61_000;
    expect(await gates()).toEqual({ servers: true, publishers: false });
    expect(calls).toHaveLength(4);
    expect(warned).toEqual([]);
  });

  it("reads closed, and says why once, where WorkOS is not configured, a flag is missing, or the read fails", async () => {
    const warned: string[] = [];
    const none = gateReader(async () => null, { warn: (m) => warned.push(m) });
    expect(await none()).toEqual({ servers: false, publishers: false });
    expect(warned[0]).toContain("not configured");
    const partial = gateReader(async () => flagsOnly({ [GATE_SLUGS.servers]: { enabled: true, defaultValue: true }, [GATE_SLUGS.publishers]: new Error("503") }), { warn: (m) => warned.push(m) });
    expect(await partial()).toEqual({ servers: true, publishers: false });
    expect(warned.some((m) => m.includes(GATE_SLUGS.publishers) && m.includes("503"))).toBe(true);
    const missing = gateReader(async () => flagsOnly({}), { warn: (m) => warned.push(m) });
    expect(await missing()).toEqual({ servers: false, publishers: false });
    expect(warned.some((m) => m.includes(`no flag "${GATE_SLUGS.servers}"`))).toBe(true);
    // A flag switched off, or on for some people only, is not a launch.
    const off = gateReader(async () => flagsOnly({ [GATE_SLUGS.servers]: { enabled: false, defaultValue: true }, [GATE_SLUGS.publishers]: { enabled: true, defaultValue: false } }));
    expect(await off()).toEqual({ servers: false, publishers: false });
  });

  it("shares one read among a burst of callers on a cold container", async () => {
    const calls: string[] = [];
    const workos = flagsOnly({ [GATE_SLUGS.servers]: { enabled: true, defaultValue: true }, [GATE_SLUGS.publishers]: { enabled: true, defaultValue: true } }, calls);
    const gates = gateReader(async () => workos);
    const answers = await Promise.all([gates(), gates(), gates()]);
    expect(answers.every((a) => a.servers && a.publishers)).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
