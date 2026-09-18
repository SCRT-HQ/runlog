export type HexColor = string & { readonly __hexColor: unique symbol };

const MAX_INPUT_LENGTH = 256;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CHANNEL = String.raw`(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)%|[0-9]+`;
const WHITESPACE = String.raw`[ \t\n\r\f]`;
const COMMA_RGB = new RegExp(
  String.raw`^rgb\(${WHITESPACE}*(${CHANNEL})${WHITESPACE}*,${WHITESPACE}*(${CHANNEL})${WHITESPACE}*,${WHITESPACE}*(${CHANNEL})${WHITESPACE}*\)$`,
  "i",
);
const SPACE_RGB = new RegExp(
  String.raw`^rgb\(${WHITESPACE}*(${CHANNEL})${WHITESPACE}+(${CHANNEL})${WHITESPACE}+(${CHANNEL})${WHITESPACE}*\)$`,
  "i",
);

function canonicalHex(red: number, green: number, blue: number): HexColor {
  const channelHex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}` as HexColor;
}

function parseRgbChannels(input: string): [number, number, number] | null {
  const match = COMMA_RGB.exec(input) ?? SPACE_RGB.exec(input);
  if (!match) return null;

  const channels = match.slice(1);
  const percentages = channels.map((channel) => channel.endsWith("%"));
  const allPercentages = percentages.every(Boolean);
  if (!allPercentages && percentages.some(Boolean)) return null;

  const parsed = channels.map((channel) => {
    const value = Number(allPercentages ? channel.slice(0, -1) : channel);
    const maximum = allPercentages ? 100 : 255;
    if (!Number.isFinite(value) || value < 0 || value > maximum) return null;
    return allPercentages ? Math.round((value * 255) / 100) : value;
  });

  if (parsed.some((channel) => channel === null)) return null;
  return parsed as [number, number, number];
}

export function parseOpaqueColor(input: unknown): HexColor | null {
  if (typeof input !== "string" || input.length > MAX_INPUT_LENGTH) return null;

  const normalized = input.trim();
  const hexMatch = HEX_COLOR.exec(normalized);
  if (hexMatch) {
    const digits = hexMatch[1]!;
    const expanded =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit.repeat(2))
            .join("")
        : digits;
    return `#${expanded.toLowerCase()}` as HexColor;
  }

  const channels = parseRgbChannels(normalized);
  return channels ? canonicalHex(...channels) : null;
}
