import { describe, expect, it } from "vitest";
import { appPath, baseOf, honestAddress, isAppPath, welcomePath, whereTo } from "./route.ts";

const at = (over: Partial<Parameters<typeof whereTo>[0]> = {}) => ({ protocol: "https:", pathname: "/", base: "/", hash: "", search: "", skip: false, ...over });

describe("which page an address opens", () => {
  it("opens the welcome page at the bare address, and the app under play", () => {
    expect(whereTo(at())).toBe("welcome");
    expect(whereTo(at({ pathname: "/play" }))).toBe("app");
    expect(whereTo(at({ pathname: "/play/" }))).toBe("app");
    expect(whereTo(at({ pathname: "/runlog/", base: "/runlog/" }))).toBe("welcome");
    expect(whereTo(at({ pathname: "/runlog/play", base: "/runlog/" }))).toBe("app");
  });

  it("is the app for anyone who arrived with somewhere to go", () => {
    expect(whereTo(at({ hash: "#run/01X?t=abc" }))).toBe("app");
    expect(whereTo(at({ hash: "#guide/start" }))).toBe("app");
    expect(whereTo(at({ hash: "#widget/clock/01X" }))).toBe("app");
    expect(whereTo(at({ search: "?invite=tok" }))).toBe("app");
    expect(whereTo(at({ search: "?code=abc&state=x" }))).toBe("app");
    expect(whereTo(at({ search: "?open" }))).toBe("app");
  });

  it("is the welcome page when asked for by name, skipped or not, and never from a file", () => {
    expect(whereTo(at({ search: "?welcome", skip: true }))).toBe("welcome");
    expect(whereTo(at({ pathname: "/play", search: "?welcome" }))).toBe("welcome");
    expect(whereTo(at({ search: "?welcome", hash: "#guide/start" }))).toBe("app");
    expect(welcomePath("https:", "/runlog/")).toBe("/runlog/?welcome");
    expect(welcomePath("file:", "/C:/runlog/")).toBeNull();
  });

  it("is the app when the person chose to skip, and always from a file", () => {
    expect(whereTo(at({ skip: true }))).toBe("app");
    expect(whereTo(at({ protocol: "file:", pathname: "/C:/runlog/index.html", base: "/C:/runlog/" }))).toBe("app");
  });

  it("makes the address read play once the app is the page, leaving a sign-in alone", () => {
    expect(honestAddress(at({ hash: "#guide/start" }))).toBe("/play#guide/start");
    expect(honestAddress(at({ search: "?invite=tok" }))).toBe("/play?invite=tok");
    expect(honestAddress(at({ search: "?open" }))).toBe("/play");
    expect(honestAddress(at({ base: "/runlog/", pathname: "/runlog/", skip: true }))).toBe("/runlog/play");
    expect(honestAddress(at({ pathname: "/play", hash: "#catalog" }))).toBeNull();
    expect(honestAddress(at({ search: "?code=abc&state=x" }))).toBeNull();
    expect(honestAddress(at({ protocol: "file:", pathname: "/C:/runlog/index.html", base: "/C:/runlog/" }))).toBeNull();
  });

  it("knows its base and the app's path under it", () => {
    expect(baseOf("https://runlog.example/")).toBe("/");
    expect(baseOf("https://runlog.example/play")).toBe("/");
    expect(baseOf("https://scrt-hq.github.io/runlog/play")).toBe("/runlog/");
    expect(appPath("/runlog/")).toBe("/runlog/play");
    expect(isAppPath("/runlog/play/", "/runlog/")).toBe(true);
    // A page under play is the app's too; a page beside it is not.
    expect(isAppPath("/play/guide/streaming", "/")).toBe(true);
    expect(isAppPath("/runlog/play/profile/servers", "/runlog/")).toBe(true);
    expect(isAppPath("/playground", "/")).toBe(false);
  });
});
