import { describe, expect, it } from "vitest";
import {
  PROFILE_PAGES,
  profileAccessFor,
  profileHash,
  profilePageFromHash,
  visibleProfilePages,
  type ProfilePage,
  type ServerAvailability,
} from "./route.ts";

const IDS_WITH_SERVERS = ["profile", "publishing", "developer", "account", "social", "streaming", "servers", "settings"];
const IDS_WITHOUT_SERVERS = ["profile", "publishing", "developer", "account", "social", "streaming", "settings"];

describe("profile page access", () => {
  it("describes every page available at this checkpoint without publishing a future route", () => {
    expect(PROFILE_PAGES).toEqual([
      { id: "profile", label: "Profile", audience: "account", applicability: "always" },
      { id: "publishing", label: "Publishing", audience: "account", applicability: "always" },
      { id: "developer", label: "Developer keys", audience: "account", applicability: "always" },
      { id: "account", label: "Account", audience: "account", applicability: "always" },
      { id: "social", label: "Social", audience: "account", applicability: "always" },
      { id: "streaming", label: "Streaming", audience: "account", applicability: "always" },
      { id: "servers", label: "Servers", audience: "account", applicability: "servers" },
      { id: "settings", label: "Settings", audience: "any", applicability: "always" },
    ]);
  });

  it("parses and formats the Developer keys address", () => {
    expect(profilePageFromHash("#profile/developer")).toBe("developer");
    expect(profileHash("developer")).toBe("#profile/developer");
  });

  it("reads a page off a profile address that also carries a query string", () => {
    expect(profilePageFromHash("#profile/servers?utm_source=test")).toBe("servers");
    expect(profilePageFromHash("#profile/account?billing=done&product=plus")).toBe("account");
    expect(profilePageFromHash("#profile?ref=nav")).toBe("profile");
    expect(profilePageFromHash("#profile/nonsense?x=1")).toBe("profile");
  });

  it.each([
    ["local", "checking", ["settings"]],
    ["local", "available", ["settings"]],
    ["local", "unavailable", ["settings"]],
    ["local", "error", ["settings"]],
    ["checking", "checking", ["settings"]],
    ["checking", "available", ["settings"]],
    ["checking", "unavailable", ["settings"]],
    ["checking", "error", ["settings"]],
    ["anonymous", "checking", ["settings"]],
    ["anonymous", "available", ["settings"]],
    ["anonymous", "unavailable", ["settings"]],
    ["anonymous", "error", ["settings"]],
    ["signed-in", "checking", IDS_WITHOUT_SERVERS],
    ["signed-in", "available", IDS_WITH_SERVERS],
    ["signed-in", "unavailable", IDS_WITHOUT_SERVERS],
    ["signed-in", "error", IDS_WITHOUT_SERVERS],
  ] as const)("shows the %s rail while Servers are %s", (account, servers, expected) => {
    expect(visibleProfilePages(account, servers, "profile").map((page) => page.id)).toEqual(expected);
  });

  it.each(["checking", "available", "unavailable", "error"] as const)(
    "keeps Servers in a signed-in rail while its %s direct route explains that state",
    (servers) => {
      expect(visibleProfilePages("signed-in", servers, "servers").map((page) => page.id)).toEqual(IDS_WITH_SERVERS);
    },
  );

  it("keeps Settings available to every account state", () => {
    for (const account of ["local", "checking", "anonymous", "signed-in"] as const) {
      expect(profileAccessFor("settings", account, "error")).toEqual({ kind: "content", page: "settings" });
    }
  });

  it("applies the same account policy to every private non-server page", () => {
    const pages: ProfilePage[] = ["profile", "publishing", "developer", "account", "social", "streaming"];
    for (const page of pages) {
      expect(profileAccessFor(page, "local", "available")).toEqual({ kind: "replace", page: "settings" });
      expect(profileAccessFor(page, "checking", "available")).toEqual({ kind: "checking" });
      expect(profileAccessFor(page, "anonymous", "available")).toEqual({ kind: "sign-in" });
      expect(profileAccessFor(page, "signed-in", "available")).toEqual({ kind: "content", page });
    }
  });

  it("keeps the signed-in Servers route honest for every server state", () => {
    const expected: Record<ServerAvailability, object> = {
      checking: { kind: "checking" },
      available: { kind: "content", page: "servers" },
      unavailable: { kind: "unavailable", page: "servers" },
      error: { kind: "error", page: "servers" },
    };
    for (const servers of ["checking", "available", "unavailable", "error"] as const) {
      expect(profileAccessFor("servers", "signed-in", servers)).toEqual(expected[servers]);
    }
  });

  it("uses the account gate before server applicability", () => {
    expect(profileAccessFor("servers", "local", "error")).toEqual({ kind: "replace", page: "settings" });
    expect(profileAccessFor("servers", "checking", "unavailable")).toEqual({ kind: "checking" });
    expect(profileAccessFor("servers", "anonymous", "checking")).toEqual({ kind: "sign-in" });
  });
});
