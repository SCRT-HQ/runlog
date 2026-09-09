import { describe, expect, it } from "vitest";
import { linkFromHash } from "./route.ts";

describe("a link address from somewhere else of the person's", () => {
  it("names what is being linked and carries the code, and nothing without a code", () => {
    expect(linkFromHash("#link/discord?c=ABCDEF")).toEqual({ kind: "discord", code: "ABCDEF" });
    expect(linkFromHash("#link/guild?c=CLAIMA")).toEqual({ kind: "guild", code: "CLAIMA" });
    expect(linkFromHash("#link/discord?c=%20ghjklm%20")).toEqual({ kind: "discord", code: "ghjklm" });
    expect(linkFromHash("#link/discord")).toBeNull();
    expect(linkFromHash("#link/discord?c=")).toBeNull();
    // A verification for linked roles: asked for by Discord, or coming back either way.
    expect(linkFromHash("#link/discord?verify=1")).toEqual({ kind: "verify", result: "asked" });
    expect(linkFromHash("#link/discord?verified=1")).toEqual({ kind: "verify", result: "done" });
    expect(linkFromHash("#link/discord?verified=0")).toEqual({ kind: "verify", result: "failed" });
    expect(linkFromHash("#link/guild?verify=1")).toBeNull();
    expect(linkFromHash("#link/twitch?c=ABCDEF")).toBeNull();
    expect(linkFromHash("#run/r?t=tok")).toBeNull();
  });
});
