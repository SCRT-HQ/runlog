import { describe, expect, it } from "vitest";
import { liveFromHash } from "./route.ts";

describe("a live link", () => {
  it("names the run and carries the token", () => {
    expect(liveFromHash("#run/01ABC?t=tok")).toEqual({ id: "01ABC", token: "tok" });
    expect(liveFromHash("#run/01ABC?x=1&t=tok")).toEqual({ id: "01ABC", token: "tok" });
  });
  it("is nothing without a token, and is not a widget or a guide page", () => {
    expect(liveFromHash("#run/01ABC")).toBeNull();
    expect(liveFromHash("#run/01ABC?t=")).toBeNull();
    expect(liveFromHash("#widget/clock/01ABC?t=tok")).toBeNull();
    expect(liveFromHash("#guide/start")).toBeNull();
  });
});
