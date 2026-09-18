import { describe, expect, it } from "vitest";

import { parseOpaqueColor } from "./index.ts";

describe("opaque theme colors", () => {
  it.each([
    ["#AbC", "#aabbcc"],
    ["  #A0b1C2  ", "#a0b1c2"],
    ["rgb(255, 0, 128)", "#ff0080"],
    ["RGB(255 0 128)", "#ff0080"],
    ["rgb(100% 0% 50%)", "#ff0080"],
    ["rgb(0%, 100%, 0%)", "#00ff00"],
    ["rgb(.5% 0% 100%)", "#0100ff"],
    ["rgb(0 0 0)", "#000000"],
    [" \tRgB(255 0 128)\n", "#ff0080"],
  ])("normalizes %s", (input, output) => {
    expect(parseOpaqueColor(input)).toBe(output);
  });

  it.each([
    null,
    undefined,
    123,
    {},
    [],
    "",
    "red",
    "transparent",
    "currentColor",
    "#12",
    "#1234",
    "#12345678",
    "rgb(256 0 0)",
    "rgb(-1, 0, 0)",
    "rgb(0.5 0 0)",
    "rgb(101% 0% 0%)",
    "rgb(100% 0 0)",
    "rgb(1e2 0 0)",
    "rgb(1, 2 3)",
    "rgb(1 2 3 / 1)",
    "rgba(1,2,3,1)",
    "rgb(1 2)",
    "rgb(1 2 3 4)",
    "var(--text)",
    "url(https://example.test)",
    "#ffffff; color: red",
    "rgb(1 2 3) trailing",
    "rgb(255/**/ 0 128)",
    `#fff${" ".repeat(253)}`,
  ])("rejects invalid or unsafe input %j", (input) => {
    expect(parseOpaqueColor(input)).toBeNull();
  });
});
