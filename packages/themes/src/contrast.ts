import type { HexColor } from "./color.ts";

export interface ContrastAssessment {
  ratio: number;
  minimum: number;
  passes: boolean;
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: HexColor): number {
  const red = linearize(Number.parseInt(color.slice(1, 3), 16) / 255);
  const green = linearize(Number.parseInt(color.slice(3, 5), 16) / 255);
  const blue = linearize(Number.parseInt(color.slice(5, 7), 16) / 255);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: HexColor, background: HexColor): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

export function assessContrast(foreground: HexColor, background: HexColor, minimum: 3 | 4.5 | 7): ContrastAssessment {
  const ratio = contrastRatio(foreground, background);
  return { ratio, minimum, passes: ratio >= minimum };
}
