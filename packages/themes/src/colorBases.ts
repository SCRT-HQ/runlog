import { parseOpaqueColor, type HexColor } from "./color.ts";
import type { CoreColorTokenId } from "./colorRegistry.ts";

export type BuiltinColorBaseId =
  | "lights-down"
  | "daylight"
  | "ember"
  | "glaze"
  | "high-contrast-dark"
  | "high-contrast-light"
  | "retro-arcade"
  | "cyberpunk"
  | "stardust"
  | "cyberpunk-neon"
  | "superstar"
  | "rainbow-road"
  | "red-green-dark"
  | "red-green-light"
  | "blue-yellow-dark"
  | "blue-yellow-light";

export interface BuiltinColorBase {
  readonly id: BuiltinColorBaseId;
  readonly revision: 1 | 2;
  readonly colorScheme: "light" | "dark";
  readonly colors: Readonly<Record<CoreColorTokenId, HexColor>>;
}

function createColors(colors: Record<CoreColorTokenId, string>): Readonly<Record<CoreColorTokenId, HexColor>> {
  const normalizedEntries = Object.entries(colors).map(([id, input]) => {
    const color = parseOpaqueColor(input);
    if (color === null) throw new TypeError(`Invalid built-in color for ${id}`);
    return [id, color] as const;
  });

  return Object.freeze(Object.fromEntries(normalizedEntries) as Record<CoreColorTokenId, HexColor>);
}

function createBase(
  id: BuiltinColorBaseId,
  colorScheme: "light" | "dark",
  colors: Record<CoreColorTokenId, string>,
  revision: 1 | 2 = 1,
): BuiltinColorBase {
  return Object.freeze({
    id,
    revision,
    colorScheme,
    colors: createColors(colors),
  });
}

const builtinColorBases: Readonly<Record<BuiltinColorBaseId, BuiltinColorBase>> = Object.freeze({
  "lights-down": createBase("lights-down", "dark", {
    "surface.page": "#151311",
    "surface.panel": "#1e1b18",
    "surface.raised": "#26221e",
    "text.primary": "#ece5d8",
    "text.muted": "#b3a99b",
    "text.onAccent": "#151311",
    "boundary.decorative": "#3a342e",
    "boundary.control": "#3a342e",
    "boundary.strong": "#5a524a",
    "interaction.accent": "#9fd3b6",
    "interaction.accentTint": "#3b5f4c",
    "interaction.selectedIndicator": "#9fd3b6",
    "interaction.focus": "#9fd3b6",
    "feedback.success": "#9fd3b6",
    "feedback.warning": "#e0a94f",
    "feedback.danger": "#e4736b",
  }),
  daylight: createBase("daylight", "light", {
    "surface.page": "#edeae2",
    "surface.panel": "#e4e0d6",
    "surface.raised": "#dbd6ca",
    "text.primary": "#1c1a17",
    "text.muted": "#4a453e",
    "text.onAccent": "#f4f2ec",
    "boundary.decorative": "#cbc4b7",
    "boundary.control": "#cbc4b7",
    "boundary.strong": "#a89f91",
    "interaction.accent": "#3d7a5b",
    "interaction.accentTint": "#b9d6c5",
    "interaction.selectedIndicator": "#3d7a5b",
    "interaction.focus": "#3d7a5b",
    "feedback.success": "#3d7a5b",
    "feedback.warning": "#9c6a15",
    "feedback.danger": "#b4433a",
  }),
  ember: createBase("ember", "dark", {
    "surface.page": "#1a1210",
    "surface.panel": "#241915",
    "surface.raised": "#2e211c",
    "text.primary": "#f1e4d3",
    "text.muted": "#bfa48f",
    "text.onAccent": "#1a1210",
    "boundary.decorative": "#45312a",
    "boundary.control": "#45312a",
    "boundary.strong": "#6a4d42",
    "interaction.accent": "#a9cbb0",
    "interaction.accentTint": "#4a5f4f",
    "interaction.selectedIndicator": "#a9cbb0",
    "interaction.focus": "#a9cbb0",
    "feedback.success": "#a9cbb0",
    "feedback.warning": "#f2b45a",
    "feedback.danger": "#f08070",
  }),
  glaze: createBase("glaze", "dark", {
    "surface.page": "#101a17",
    "surface.panel": "#17231f",
    "surface.raised": "#1e2d28",
    "text.primary": "#e4ece6",
    "text.muted": "#9db3a8",
    "text.onAccent": "#101a17",
    "boundary.decorative": "#2b3a34",
    "boundary.control": "#2b3a34",
    "boundary.strong": "#4a5f57",
    "interaction.accent": "#a8dcc0",
    "interaction.accentTint": "#33584a",
    "interaction.selectedIndicator": "#a8dcc0",
    "interaction.focus": "#a8dcc0",
    "feedback.success": "#a8dcc0",
    "feedback.warning": "#e6b15c",
    "feedback.danger": "#e78a80",
  }),
  "high-contrast-dark": createBase("high-contrast-dark", "dark", {
    "surface.page": "#080808",
    "surface.panel": "#141414",
    "surface.raised": "#202020",
    "text.primary": "#ffffff",
    "text.muted": "#dedede",
    "text.onAccent": "#080808",
    "boundary.decorative": "#777777",
    "boundary.control": "#aaaaaa",
    "boundary.strong": "#dedede",
    "interaction.accent": "#ffdb66",
    "interaction.accentTint": "#302a18",
    "interaction.selectedIndicator": "#ffdb66",
    "interaction.focus": "#a9ddff",
    "feedback.success": "#a9efb1",
    "feedback.warning": "#ffe6a6",
    "feedback.danger": "#ffb5a9",
  }),
  "high-contrast-light": createBase("high-contrast-light", "light", {
    "surface.page": "#ffffff",
    "surface.panel": "#f5f5f5",
    "surface.raised": "#eaeaea",
    "text.primary": "#111111",
    "text.muted": "#333333",
    "text.onAccent": "#ffffff",
    "boundary.decorative": "#777777",
    "boundary.control": "#555555",
    "boundary.strong": "#333333",
    "interaction.accent": "#164a6e",
    "interaction.accentTint": "#dce8ef",
    "interaction.selectedIndicator": "#164a6e",
    "interaction.focus": "#164a6e",
    "feedback.success": "#24552c",
    "feedback.warning": "#794900",
    "feedback.danger": "#8a2222",
  }),
  "retro-arcade": createBase("retro-arcade", "dark", {
    "surface.page": "#101810",
    "surface.panel": "#1b281b",
    "surface.raised": "#263426",
    "text.primary": "#ecf7d7",
    "text.muted": "#bdd0ab",
    "text.onAccent": "#101810",
    "boundary.decorative": "#4b6244",
    "boundary.control": "#91ab7e",
    "boundary.strong": "#bdd0ab",
    "interaction.accent": "#a8ed70",
    "interaction.accentTint": "#304427",
    "interaction.selectedIndicator": "#a8ed70",
    "interaction.focus": "#ffd36b",
    "feedback.success": "#a8ed70",
    "feedback.warning": "#ffd36b",
    "feedback.danger": "#ffa38c",
  }),
  cyberpunk: createBase("cyberpunk", "dark", {
    "surface.page": "#11151e",
    "surface.panel": "#202837",
    "surface.raised": "#2a3445",
    "text.primary": "#edf2f7",
    "text.muted": "#b9c8d9",
    "text.onAccent": "#11151e",
    "boundary.decorative": "#4d6078",
    "boundary.control": "#8cabc4",
    "boundary.strong": "#b9c8d9",
    "interaction.accent": "#f1ed69",
    "interaction.accentTint": "#414126",
    "interaction.selectedIndicator": "#f1ed69",
    "interaction.focus": "#8bd9ed",
    "feedback.success": "#93e6b5",
    "feedback.warning": "#ffd28a",
    "feedback.danger": "#ffa5a5",
  }),
  stardust: createBase("stardust", "light", {
    "surface.page": "#f2f1ea",
    "surface.panel": "#fcfbf6",
    "surface.raised": "#e4e5df",
    "text.primary": "#243449",
    "text.muted": "#505c68",
    "text.onAccent": "#fffaf0",
    "boundary.decorative": "#c49a50",
    "boundary.control": "#687789",
    "boundary.strong": "#46566b",
    "interaction.accent": "#9b411f",
    "interaction.accentTint": "#f0dfbe",
    "interaction.selectedIndicator": "#a2393d",
    "interaction.focus": "#315881",
    "feedback.success": "#2e694d",
    "feedback.warning": "#835900",
    "feedback.danger": "#a2393d",
  }),
  "cyberpunk-neon": createBase("cyberpunk-neon", "dark", {
    "surface.page": "#160d24",
    "surface.panel": "#30204b",
    "surface.raised": "#3a2959",
    "text.primary": "#f5edff",
    "text.muted": "#cdbbe8",
    "text.onAccent": "#160d24",
    "boundary.decorative": "#69547f",
    "boundary.control": "#ad94c9",
    "boundary.strong": "#cdbbe8",
    "interaction.accent": "#ff64d8",
    "interaction.accentTint": "#522644",
    "interaction.selectedIndicator": "#ff64d8",
    "interaction.focus": "#62cfff",
    "feedback.success": "#a4edc1",
    "feedback.warning": "#ffd27a",
    "feedback.danger": "#ff9a88",
  }),
  superstar: createBase("superstar", "light", {
    "surface.page": "#e5e3ec",
    "surface.panel": "#f5f3fa",
    "surface.raised": "#d9d5e5",
    "text.primary": "#242134",
    "text.muted": "#514667",
    "text.onAccent": "#ffffff",
    "boundary.decorative": "#aaa1ba",
    "boundary.control": "#75618f",
    "boundary.strong": "#5e467f",
    "interaction.accent": "#654397",
    "interaction.accentTint": "#ddd1ef",
    "interaction.selectedIndicator": "#654397",
    "interaction.focus": "#503182",
    "feedback.success": "#28613e",
    "feedback.warning": "#805200",
    "feedback.danger": "#a12f4a",
  }),
  "rainbow-road": createBase("rainbow-road", "light", {
    "surface.page": "#ededeb",
    "surface.panel": "#fafaf7",
    "surface.raised": "#dfdfdb",
    "text.primary": "#202528",
    "text.muted": "#475259",
    "text.onAccent": "#ffffff",
    "boundary.decorative": "#c4a128",
    "boundary.control": "#245ab3",
    "boundary.strong": "#475259",
    "interaction.accent": "#a92734",
    "interaction.accentTint": "#fff0b2",
    "interaction.selectedIndicator": "#126c3f",
    "interaction.focus": "#245ab3",
    "feedback.success": "#126c3f",
    "feedback.warning": "#805600",
    "feedback.danger": "#a92734",
  }),
  "red-green-dark": createBase("red-green-dark", "dark", {
    "surface.page": "#151311",
    "surface.panel": "#1e1b18",
    "surface.raised": "#26221e",
    "text.primary": "#ece5d8",
    "text.muted": "#b8ae9f",
    "text.onAccent": "#151311",
    "boundary.decorative": "#3a342e",
    "boundary.control": "#857a6c",
    "boundary.strong": "#6a6157",
    "interaction.accent": "#7fbfe6",
    "interaction.accentTint": "#23475d",
    "interaction.selectedIndicator": "#7fbfe6",
    "interaction.focus": "#ded8ff",
    "feedback.success": "#7fbfe6",
    "feedback.warning": "#f9c44f",
    "feedback.danger": "#ee8964",
  }),
  "red-green-light": createBase("red-green-light", "light", {
    "surface.page": "#f2efe8",
    "surface.panel": "#faf8f3",
    "surface.raised": "#e8e4da",
    "text.primary": "#1c1a17",
    "text.muted": "#4a453e",
    "text.onAccent": "#faf8f3",
    "boundary.decorative": "#b6afa4",
    "boundary.control": "#7d7467",
    "boundary.strong": "#5f584e",
    "interaction.accent": "#1d5b8c",
    "interaction.accentTint": "#d4e3ef",
    "interaction.selectedIndicator": "#1d5b8c",
    "interaction.focus": "#2a2060",
    "feedback.success": "#1d5b8c",
    "feedback.warning": "#643b00",
    "feedback.danger": "#984f3d",
  }),
  "blue-yellow-dark": createBase("blue-yellow-dark", "dark", {
    "surface.page": "#1a1210",
    "surface.panel": "#241915",
    "surface.raised": "#2e211c",
    "text.primary": "#f1e4d3",
    "text.muted": "#c4ab96",
    "text.onAccent": "#1a1210",
    "boundary.decorative": "#45312a",
    "boundary.control": "#8f7566",
    "boundary.strong": "#6a4d42",
    "interaction.accent": "#8fd0c0",
    "interaction.accentTint": "#0a484c",
    "interaction.selectedIndicator": "#8fd0c0",
    "interaction.focus": "#efe4ff",
    "feedback.success": "#8fd0c0",
    "feedback.warning": "#f3c969",
    "feedback.danger": "#f47a5e",
  }),
  "blue-yellow-light": createBase("blue-yellow-light", "light", {
    "surface.page": "#f3eee9",
    "surface.panel": "#fbf8f5",
    "surface.raised": "#eae3dc",
    "text.primary": "#221a17",
    "text.muted": "#52453e",
    "text.onAccent": "#fbf8f5",
    "boundary.decorative": "#baaca5",
    "boundary.control": "#85756a",
    "boundary.strong": "#62534a",
    "interaction.accent": "#1f6a5c",
    "interaction.accentTint": "#cfe6df",
    "interaction.selectedIndicator": "#1f6a5c",
    "interaction.focus": "#243f8f",
    "feedback.success": "#1f6a5c",
    "feedback.warning": "#6a3a00",
    "feedback.danger": "#ac2639",
  }),
});

const builtinColorBaseIds = new Set<string>(Object.keys(builtinColorBases));

const samurai2 = createBase(
  "cyberpunk-neon",
  "dark",
  {
    ...builtinColorBases["cyberpunk-neon"].colors,
    "text.muted": "#b9dfff",
    "boundary.control": "#62cfff",
    "interaction.selectedIndicator": "#62cfff",
  },
  2,
);

export function getBuiltinColorBase(id: unknown, revision?: unknown): BuiltinColorBase | null {
  if (typeof id !== "string" || !builtinColorBaseIds.has(id)) return null;
  if (revision === undefined) return id === "cyberpunk-neon" ? samurai2 : builtinColorBases[id as BuiltinColorBaseId];
  if (revision === 1) return builtinColorBases[id as BuiltinColorBaseId];
  if (revision === 2 && id === "cyberpunk-neon") return samurai2;

  return null;
}
