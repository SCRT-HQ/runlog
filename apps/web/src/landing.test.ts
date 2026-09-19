import { describe, expect, it } from "vitest";
import { landingOf, type Landing } from "./landing.ts";
import { addressOf } from "./route.ts";

const pack = "com.example.practice";
const sections: Array<[string, Partial<Landing>]> = [
  ["#packs", { view: "library" }],
  ["#marketplace", { view: "marketplace", marketplaceFocus: null }],
  [`#marketplace/${pack}`, { view: "marketplace", marketplaceFocus: pack }],
  [
    `#marketplace/${pack}/docs`,
    { view: "marketplace", marketplaceFocus: pack, docs: { at: { section: "marketplace", id: pack }, kind: "summary" } },
  ],
  ["#guide/start", { view: "guide", guide: { slug: "start", section: null } }],
  ["#create", { view: "design" }],
  ["#create/tables", { view: "design" }],
  ["#profile/publishing", { view: "profile", profilePage: "publishing" }],
  ["#themes", { view: "themes" }],
  ["#themes/recovery", { view: "themes" }],
  ["#play", { view: "play" }],
  ["#run/example", { run: "example" }],
  ["#seat/example", { seat: "example" }],
];

describe("the initial destination", () => {
  it.each(sections)("reads %s before the first render", (address, expected) => {
    expect(landingOf(address)).toMatchObject(expected);
  });

  // Test mode deliberately disables hosted paths by default. Supply the
  // deployment base explicitly to exercise the real path parser rather
  // than mistaking a hash-only mount for hosted-path coverage.
  for (const base of ["/", "/runlog/"]) {
    it.each(sections)(`reads the hosted spelling of %s under ${base}`, (address, expected) => {
      const loc = new URL(`${base}${address.slice(1)}`, "https://example.test");
      expect(landingOf(addressOf(loc, base))).toMatchObject(expected);
    });
  }

  it("lets a named hash take precedence over the hosted path", () => {
    const loc = new URL("https://example.test/packs#create/tables");
    expect(landingOf(addressOf(loc, "/"))).toMatchObject({ view: "design" });
  });

  it("preserves the legacy hosted play prefix", () => {
    const loc = new URL(`https://example.test/play/marketplace/${pack}`);
    expect(landingOf(addressOf(loc, "/"))).toMatchObject({ view: "marketplace", marketplaceFocus: pack });
  });

  it("keeps public viewing separate from opening an owned run", () => {
    const loc = new URL("https://example.test/run/example?t=example-token");
    const destination = landingOf(addressOf(loc, "/"));
    expect(destination.live).toEqual({ id: "example", token: "example-token" });
    expect(destination.run).toBeUndefined();
    expect(destination.view).toBeUndefined();
  });

  it("keeps widget and dock destinations outside section navigation", () => {
    expect(landingOf("#widget/clock/example?bg=none")).toMatchObject({
      widget: { kind: "clock", runId: "example", bg: "none" },
    });
    expect(landingOf("#dock/controls/example")).toMatchObject({ dock: { runId: "example" } });
  });

  it("leaves unknown and bare addresses without a new section", () => {
    for (const address of ["", "#unknown", "#themes/unknown"]) {
      expect(landingOf(address)).toEqual({ widget: null, dock: null, live: null, seat: null });
    }
  });
});
