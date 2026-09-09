import { describe, expect, it } from "vitest";
import { gateReader, HOLD_SLUGS } from "../lib/handlers/gates";
import type { WorkOSLike } from "../lib/handlers/workos";

/** A WorkOS that answers flags only, from a table a test fills. */
function flagsOnly(table: Record<string, { enabled: boolean; defaultValue: boolean } | null | Error>, calls: string[] = []): WorkOSLike {
  const never = () => Promise.reject(new Error("not this test"));
  return {
    createOrganization: never,
    renameOrganization: never,
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

const HELD = { enabled: true, defaultValue: true };

describe("release gates", () => {
  it("holds a tier back only for a flag that is on for everyone, and asks once a minute", async () => {
    const calls: string[] = [];
    let at = 0;
    const warned: string[] = [];
    const workos = flagsOnly({ [HOLD_SLUGS.servers]: HELD, [HOLD_SLUGS.publishers]: { enabled: true, defaultValue: false } }, calls);
    const gates = gateReader(async () => workos, { now: () => at, warn: (m) => warned.push(m) });
    expect(await gates()).toEqual({ servers: false, publishers: true });
    expect(calls).toEqual([HOLD_SLUGS.servers, HOLD_SLUGS.publishers]);
    // Within the minute the answer is remembered; after it, asked again.
    at = 30_000;
    expect(await gates()).toEqual({ servers: false, publishers: true });
    expect(calls).toHaveLength(2);
    at = 61_000;
    expect(await gates()).toEqual({ servers: false, publishers: true });
    expect(calls).toHaveLength(4);
    expect(warned).toEqual([]);
  });

  it("reads open where WorkOS is not configured, a flag is missing, switched off, or the read fails, and says why", async () => {
    const warned: string[] = [];
    const none = gateReader(async () => null, { warn: (m) => warned.push(m) });
    expect(await none()).toEqual({ servers: true, publishers: true });
    expect(warned[0]).toContain("not configured");
    const partial = gateReader(async () => flagsOnly({ [HOLD_SLUGS.servers]: HELD, [HOLD_SLUGS.publishers]: new Error("503") }), { warn: (m) => warned.push(m) });
    expect(await partial()).toEqual({ servers: false, publishers: true });
    expect(warned.some((m) => m.includes(HOLD_SLUGS.publishers) && m.includes("503"))).toBe(true);
    // A launch: the flag deleted, or turned off. Neither is a hold, and neither is worth a warning.
    const before = warned.length;
    const gone = gateReader(async () => flagsOnly({}), { warn: (m) => warned.push(m) });
    expect(await gone()).toEqual({ servers: true, publishers: true });
    const off = gateReader(async () => flagsOnly({ [HOLD_SLUGS.servers]: { enabled: false, defaultValue: true }, [HOLD_SLUGS.publishers]: { enabled: true, defaultValue: false } }), { warn: (m) => warned.push(m) });
    expect(await off()).toEqual({ servers: true, publishers: true });
    expect(warned).toHaveLength(before);
  });

  it("shares one read among a burst of callers on a cold container", async () => {
    const calls: string[] = [];
    const workos = flagsOnly({ [HOLD_SLUGS.servers]: HELD, [HOLD_SLUGS.publishers]: HELD }, calls);
    const gates = gateReader(async () => workos);
    const answers = await Promise.all([gates(), gates(), gates()]);
    expect(answers.every((a) => !a.servers && !a.publishers)).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
