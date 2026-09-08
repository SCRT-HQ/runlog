import { describe, expect, it } from "vitest";
import { linkFromHash } from "./route.ts";

describe("a link address from another account", () => {
  it("names the service and carries the code, and nothing without a code", () => {
    expect(linkFromHash("#link/discord?c=ABCDEF")).toEqual({ kind: "discord", code: "ABCDEF" });
    expect(linkFromHash("#link/discord?c=%20ghjklm%20")).toEqual({ kind: "discord", code: "ghjklm" });
    expect(linkFromHash("#link/discord")).toBeNull();
    expect(linkFromHash("#link/discord?c=")).toBeNull();
    expect(linkFromHash("#link/twitch?c=ABCDEF")).toBeNull();
    expect(linkFromHash("#run/r?t=tok")).toBeNull();
  });
});
