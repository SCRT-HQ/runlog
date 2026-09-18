import { parseOpaqueColor, type HexColor } from "./color.ts";
import type { CoreColorTokenId } from "./colorRegistry.ts";

export type BuiltinColorBaseId = "lights-down" | "daylight" | "ember" | "glaze";

export interface BuiltinColorBase {
  readonly id: BuiltinColorBaseId;
  readonly revision: 1;
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

function createBase(id: BuiltinColorBaseId, colorScheme: "light" | "dark", colors: Record<CoreColorTokenId, string>): BuiltinColorBase {
  return Object.freeze({
    id,
    revision: 1,
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
});

const builtinColorBaseIds = new Set<string>(Object.keys(builtinColorBases));

export function getBuiltinColorBase(id: unknown, revision?: unknown): BuiltinColorBase | null {
  const requestedRevision = revision === undefined ? 1 : revision;
  if (typeof id !== "string" || !builtinColorBaseIds.has(id) || requestedRevision !== 1) {
    return null;
  }

  return builtinColorBases[id as BuiltinColorBaseId];
}
