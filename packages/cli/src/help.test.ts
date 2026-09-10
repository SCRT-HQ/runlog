import { describe, expect, it } from "vitest";
import { asksForHelp, HELP, helpFor } from "./help.ts";

describe("asking for help", () => {
  it("sees --help or -h anywhere on the line", () => {
    expect(asksForHelp(["--help"])).toBe(true);
    expect(asksForHelp(["--api", "https://x", "-h"])).toBe(true);
    expect(asksForHelp(["pack.yaml", "--help"])).toBe(true);
  });

  it("does not read past -- , where a pack could be named anything", () => {
    expect(asksForHelp(["--", "--help"])).toBe(false);
    expect(asksForHelp(["pack.yaml", "--strict"])).toBe(false);
    expect(asksForHelp([])).toBe(false);
  });
});

describe("help for one command", () => {
  it("is that command's usage lines, continuations included", () => {
    const text = helpFor("login");
    expect(text).toContain("runlog login    [--api URL]");
    expect(text).toContain("[--key]");
    expect(text).not.toContain("runlog whoami");
    expect(text).not.toContain("runlog validate");
  });

  it("stops at the next command", () => {
    const text = helpFor("validate");
    expect(text).toContain("runlog validate");
    expect(text).not.toContain("runlog bundle");
  });

  it("falls back to the whole text for a name the usage block does not carry", () => {
    expect(helpFor("publish")).toBe(HELP);
    expect(helpFor("nothing")).toBe(HELP);
  });
});
