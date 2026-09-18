import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet has to parse, all of it.
 *
 * esbuild recovers from a syntax error by dropping the rule it cannot read
 * and printing a warning nobody reads. The build stays green while every rule
 * after the mistake is gone, which is exactly what happened when a merge lost
 * a closing brace. So the same minifier is asked here, and any warning fails.
 */
const here = dirname(fileURLToPath(import.meta.url));

async function problems(css: string): Promise<string[]> {
  const { warnings } = await transform(css, { loader: "css", minify: true, logLevel: "silent" });
  return warnings.map((w) => `${w.text}${w.location ? ` (line ${w.location.line})` : ""}`);
}

describe("the stylesheets", () => {
  for (const file of ["src/styles.css", "src/fonts.css"]) {
    it(`${file} parses without a single warning`, async () => {
      expect(await problems(readFileSync(join(here, file), "utf8"))).toEqual([]);
    });
  }

  it("would catch the brace a merge lost", async () => {
    const found = await problems(".a {\n  color: red;\n.b {\n  color: blue;\n}\n");
    expect(found.some((p) => /Expected "}"/.test(p))).toBe(true);
  });
});

/**
 * The token layer, held to what it promises rather than to a class list.
 *
 * Every rule below is stated as a property of the sheet: which names a look
 * has to answer to, what a shorthand may not undo, and where a control's
 * size is allowed to come from. A slice that migrates next month renames
 * selectors freely; these keep holding.
 */
interface Rule {
  selector: string;
  decls: { prop: string; value: string }[];
}

/** Every rule in the sheet, at-rules flattened, comments gone. */
function rules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  let at = 0;
  for (;;) {
    const open = clean.indexOf("{", at);
    if (open < 0) break;
    const selector = clean.slice(at, open).trim().replace(/\s+/g, " ");
    // An at-rule holds rules rather than declarations, so step inside it.
    if (selector.startsWith("@")) {
      at = open + 1;
      continue;
    }
    const close = clean.indexOf("}", open);
    if (close < 0) break;
    found.push({
      selector: selector.replace(/^\}\s*/, ""),
      decls: clean
        .slice(open + 1, close)
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return { prop: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
        })
        .filter((d) => d.prop),
    });
    at = close + 1;
  }
  return found;
}

function rulesInKeyframes(css: string, name: string): Rule[] {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`@keyframes\\s+${escapedName}\\s*\\{`).exec(css);
  if (!header) return [];

  const open = header.index + header[0].lastIndexOf("{");
  let depth = 1;
  let at = open + 1;
  while (at < css.length && depth > 0) {
    if (css[at] === "{") depth += 1;
    if (css[at] === "}") depth -= 1;
    at += 1;
  }
  if (depth !== 0) return [];

  return rules(css.slice(open + 1, at - 1));
}

const stylesCss = readFileSync(join(here, "src/styles.css"), "utf8");
const sheet = rules(stylesCss);
/** The blocks that paint a look: the default, the system's light, and the four saved themes. */
const looks = sheet.filter((r) => /^:root/.test(r.selector) && r.decls.some((d) => d.prop === "--bg"));

function finalDeclaration(selector: string, prop: string): string | undefined {
  return sheet
    .filter((rule) => rule.selector === selector)
    .flatMap((rule) => rule.decls)
    .filter((decl) => decl.prop === prop)
    .at(-1)?.value;
}

describe("the semantic tokens", () => {
  const roles = ["--bg", "--surface", "--surface-raised", "--line", "--text", "--text-muted", "--accent", "--warn", "--danger", "--focus"];

  it("gives every look all ten color roles of its own", () => {
    // The default, the system's light, and the four themes a saved id names.
    expect(looks.map((l) => l.selector)).toHaveLength(6);
    expect(looks.filter((l) => /\[data-theme=/.test(l.selector))).toHaveLength(4);
    for (const look of looks) {
      const named = new Set(look.decls.map((d) => d.prop));
      expect([look.selector, roles.filter((r) => !named.has(r))]).toEqual([look.selector, []]);
    }
  });

  it("declares the four families and the five type roles", () => {
    const base = looks.find((l) => l.selector === ":root");
    const named = new Set(base?.decls.map((d) => d.prop) ?? []);
    for (const token of [
      "--font-ui",
      "--font-prose",
      "--font-mono",
      "--font-technical",
      "--font-display",
      "--font-page-title",
      "--font-section-title",
      "--font-body",
      "--font-control",
      "--font-caption",
      "--control-h",
      "--control-h-compact",
      "--control-h-touch",
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `--space-${n}`),
    ]) {
      expect([token, named.has(token)]).toEqual([token, true]);
    }
  });

  it("keeps the legacy default stacks while separating technical text from numeric readouts", () => {
    const plexStack = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    expect(finalDeclaration(":root", "--font-mono")).toBe(plexStack);
    expect(finalDeclaration(":root", "--font-technical")).toBe(plexStack);
    expect(finalDeclaration(":root", "--mono")).toBe("var(--font-technical)");
  });
});

describe("control boundaries and focus borders", () => {
  it("gives every static palette a control-boundary default", () => {
    expect(looks).toHaveLength(6);
    for (const look of looks) {
      expect(look.decls).toContainEqual({ prop: "--control-boundary", value: "var(--line)" });
    }
  });

  it("separates ghost controls from decorative panels", () => {
    expect(sheet.find((r) => r.selector === ".ghost")!.decls).toContainEqual({
      prop: "border",
      value: "1px solid var(--control-boundary)",
    });
    expect(sheet.find((r) => r.selector === ".panel")!.decls).toContainEqual({ prop: "border", value: "1px solid var(--line)" });
  });

  it.each([
    [".packBtn", "border", "1px solid var(--control-boundary)"],
    [".ghost", "border", "1px solid var(--control-boundary)"],
    [".inviteForm select", "border", "1px solid var(--control-boundary)"],
    ["button:disabled, .primary:disabled, .ghost:disabled", "border-color", "var(--control-boundary)"],
    [".choice", "border", "1px solid var(--control-boundary)"],
    [".textInput, .rollInput", "border", "1px solid var(--control-boundary)"],
    [".chip.pick", "border-color", "var(--control-boundary)"],
    [".accountMenu[open] > summary", "border-color", "var(--control-boundary)"],
    [".accountMenu > summary:hover", "border-color", "var(--control-boundary)"],
    [".rowMenu > summary, .rowMenuBtn", "border", "1px solid var(--control-boundary)"],
    [".shelf > summary", "border", "1px solid var(--control-boundary)"],
    [".themeMenu select", "border", "1px solid var(--control-boundary)"],
    [".chipAdd", "border", "1px dashed var(--control-boundary)"],
    [".matrix .cell", "border", "1px solid var(--control-boundary)"],
    [".filtersToggle", "border", "1px solid var(--control-boundary)"],
    [".alertPick select", "border", "1px solid var(--control-boundary)"],
    [".guideContentsSummary", "border", "1px solid var(--control-boundary)"],
    [".toggleChip", "border-color", "var(--control-boundary)"],
    [".reactButton", "border", "1px solid var(--control-boundary)"],
    [".welcomePack", "border", "1px solid var(--control-boundary)"],
    [".personaChip", "border", "1px solid var(--control-boundary)"],
    ['.runMenuBtn[aria-expanded="true"]', "border-color", "var(--control-boundary)"],
    [".deckProfiles .rowMenuPanel .options button", "border", "1px solid var(--control-boundary)"],
  ])("gives %s its control boundary", (selector, prop, value) => {
    const matchingRule = sheet.find(
      (rule) => rule.selector === selector && rule.decls.some((decl) => decl.prop === prop && decl.value === value),
    );
    expect(matchingRule, `${selector} should declare ${prop}: ${value}`).toBeDefined();
  });

  it.each([
    [".rollInput:focus, .textInput:focus", "var(--focus)"],
    [".renameInput:focus", "var(--focus)"],
    [".runNameInput:focus", "var(--focus)"],
    [".matrix .cell:focus-visible", "var(--focus)"],
  ])("gives %s the focus border", (selector, value) => {
    expect(sheet.find((rule) => rule.selector === selector)?.decls ?? []).toContainEqual({ prop: "border-color", value });
  });

  it("keeps the matrix hover border separate from keyboard focus", () => {
    expect(sheet.find((rule) => rule.selector === ".matrix .cell:hover:not(:disabled)")?.decls ?? []).toContainEqual({
      prop: "border-color",
      value: "var(--accent)",
    });
  });

  it.each([
    ".ghost:hover:not(:disabled)",
    ".packBtn:hover",
    ".choice:hover",
    ".chip.pick:hover",
    ".renameTrigger:hover",
    ".welcomePack:hover",
    ".personaChip:hover",
  ])("gives the hovered %s control a visible focus-role boundary", (selector) => {
    expect(finalDeclaration(selector, selector === ".renameTrigger:hover" ? "border-bottom-color" : "border-color")).toBe("var(--focus)");
  });
});

describe("selection and feedback color roles", () => {
  it("keeps every contrast-catalog mixed recipe in parity with the rendered CSS", () => {
    expect(finalDeclaration(".primary:hover:not(:disabled)", "background")).toBe("color-mix(in oklab, var(--accent) 85%, var(--text))");
    expect(finalDeclaration(".primary.danger:hover:not(:disabled)", "background")).toBe(
      "color-mix(in oklab, var(--warn) 85%, var(--text))",
    );
    expect(finalDeclaration('.choices > [role="radio"][aria-checked="true"]', "background")).toBe(
      "color-mix(in oklab, var(--accent) 10%, var(--panel-2))",
    );
    expect(finalDeclaration(".notice", "color")).toBe("color-mix(in oklab, var(--warn) 55%, var(--text))");
    expect(finalDeclaration(".die.challenge .value", "fill")).toBe("color-mix(in oklab, var(--err) 60%, var(--text))");
    expect(finalDeclaration(".ghost.danger", "border-color")).toBe("color-mix(in oklab, var(--warn) 40%, var(--line))");
    expect(finalDeclaration(".widgetBody", "background")).toBe("color-mix(in srgb, var(--panel) 92%, transparent)");
    expect(finalDeclaration(':root[data-widget="clear"] .widgetBody', "background")).toBe(
      "color-mix(in srgb, var(--panel) 82%, transparent)",
    );
    expect(finalDeclaration(':root[data-widget="none"] .widgetBody', "background")).toBe("transparent");
  });

  it("cycles only direct move-card choices through four fallback-safe top accents", () => {
    expect(finalDeclaration(".choice.moveChoice", "border-top")).toBe(
      "4px solid var(--move-accent, var(--selected-indicator, var(--accent)))",
    );
    expect(finalDeclaration(".choices > .choice.moveChoice:nth-child(4n + 1)", "border-top-color")).toBe(
      "var(--move-accent, var(--selected-indicator, var(--accent)))",
    );
    expect(finalDeclaration(".choices > .choice.moveChoice:nth-child(4n + 2)", "border-top-color")).toBe(
      "var(--move-accent-2, var(--focus))",
    );
    expect(finalDeclaration(".choices > .choice.moveChoice:nth-child(4n + 3)", "border-top-color")).toBe(
      "var(--move-accent-3, var(--line))",
    );
    expect(finalDeclaration(".choices > .choice.moveChoice:nth-child(4n + 4)", "border-top-color")).toBe(
      "var(--move-accent-4, var(--accent))",
    );
    expect(finalDeclaration(".choice", "background")).toBe("var(--panel-2)");
    expect(finalDeclaration(".choice", "color")).toBe("var(--text)");
  });

  it("gives every static palette selection and success defaults without authored feedback backgrounds", () => {
    expect(looks).toHaveLength(6);
    for (const look of looks) {
      expect(look.decls).toContainEqual({ prop: "--selected-indicator", value: "var(--accent)" });
      expect(look.decls).toContainEqual({ prop: "--success", value: "var(--accent)" });

      const named = new Set(look.decls.map((decl) => decl.prop));
      expect([
        look.selector,
        ["--success-background", "--warning-background", "--danger-background"].filter((role) => named.has(role)),
      ]).toEqual([look.selector, []]);
    }
  });

  it.each([
    [".packBtn.on", "border-color", "var(--selected-indicator)"],
    [".designNavItem[aria-current]", "border-bottom-color", "var(--selected-indicator)"],
    ['.topbarEnd > [aria-current="page"]', "box-shadow", "inset 0 -2px 0 var(--selected-indicator)"],
    [".choice.on", "border-color", "var(--selected-indicator)"],
    [".tableLook li.on .range", "color", "var(--selected-indicator)"],
    [".ghost.on", "border-color", "var(--selected-indicator)"],
    [".box.on", "background", "var(--selected-indicator)"],
    [".box.on", "border-color", "var(--selected-indicator)"],
    ['.choices > [role="radio"][aria-checked="true"]', "box-shadow", "inset 0 0 0 1px var(--selected-indicator)"],
    [".chip.pick.on", "border-color", "var(--selected-indicator)"],
    [".chip.pick.on", "color", "var(--selected-indicator)"],
    [".margin .flow > li.current .idx", "color", "var(--selected-indicator)"],
    [".liveFlow .logTools .ghost.on", "border-color", "var(--selected-indicator)"],
    [".guideToc li.on", "border-left-color", "var(--selected-indicator)"],
    [".guideOnPage li.on", "border-left-color", "var(--selected-indicator)"],
    [".toggleChip.on", "border-color", "var(--selected-indicator)"],
    [".liveFlow .flow li.current .idx", "color", "var(--selected-indicator)"],
    ['.personaChip[aria-pressed="true"]', "border-color", "var(--selected-indicator)"],
    [".flowNow .idx", "color", "var(--selected-indicator)"],
    [".railTab[aria-current]", "border-top-color", "var(--selected-indicator)"],
    [".setupOption .tick", "color", "var(--selected-indicator)"],
  ])("routes the %s %s through the selected indicator", (selector, prop, value) => {
    expect(finalDeclaration(selector, prop), `${selector} should declare ${prop}: ${value}`).toBe(value);
  });

  it.each([
    [".libraryPack.inPlay", "border-color", "var(--accent-dim)"],
    [".runRow.open", "border-color", "var(--accent-dim)"],
    [".chip.ok", "border-color", "var(--accent-dim)"],
    ['.topbarEnd > [aria-current="page"]', "color", "var(--accent)"],
    ['.choices > [role="radio"][aria-checked="true"]', "background", "color-mix(in oklab, var(--accent) 10%, var(--panel-2))"],
    [".toggleChip.on", "background", "var(--accent-dim)"],
    ['.personaChip[aria-pressed="true"]', "color", "var(--accent)"],
    [".railTab[aria-current]", "color", "var(--accent)"],
    [".die.settled .body", "stroke", "var(--accent-dim)"],
    [".primary.danger", "background", "var(--warn)"],
    [".matrix .cell.won", "background", "var(--accent)"],
  ])("preserves the legacy %s %s holdout", (selector, prop, value) => {
    expect(finalDeclaration(selector, prop), `${selector} should retain ${prop}: ${value}`).toBe(value);
  });

  it("keeps hit results outside the selection role", () => {
    expect(finalDeclaration(".entries li.hit", "background")).toBe("color-mix(in oklab, var(--accent) 12%, var(--panel))");
    expect(finalDeclaration(".entries li.hit", "box-shadow")).toBe("inset 2px 0 0 var(--accent)");
  });

  it.each([
    [".chip.ok", "color", "var(--success)"],
    [".toolIcon.lit", "color", "var(--success)"],
    [".ghost.saved:disabled", "color", "var(--success)"],
    [".agreeing", "color", "var(--success)"],
    [".led.fine", "background", "var(--success)"],
    [".led.fine", "box-shadow", "0 0 6px color-mix(in oklab, var(--success) 60%, transparent)"],
    [".widgetTicker li.award .tickMark", "color", "var(--success)"],
    [".widgetTicker li.rolled .tickMark", "color", "var(--accent)"],
  ])("routes the %s %s through its intentional outcome role", (selector, prop, value) => {
    expect(finalDeclaration(selector, prop), `${selector} should declare ${prop}: ${value}`).toBe(value);
  });

  it.each([
    [".chip.heat", "background", "var(--warning-background, color-mix(in oklab, var(--warn) 14%, transparent))"],
    [".notice", "background", "var(--warning-background, color-mix(in oklab, var(--warn) 12%, var(--panel)))"],
    [".die.challenge .body", "fill", "var(--danger-background, color-mix(in oklab, var(--err) 18%, var(--panel)))"],
    [".forget:hover", "background", "var(--danger-background, color-mix(in oklab, var(--err) 12%, var(--panel)))"],
    [".threshold", "background", "var(--danger-background, color-mix(in oklab, var(--err) 8%, var(--panel)))"],
    [".coverageSeg.ok", "background", "var(--success-background, var(--accent-dim))"],
    [".coverageSeg.over", "background", "var(--warning-background, var(--warn))"],
    [".signature.bad", "background", "var(--danger-background, color-mix(in oklab, var(--err) 10%, var(--panel)))"],
    [".incoming.bad", "background", "var(--danger-background, color-mix(in oklab, var(--danger) 10%, var(--surface)))"],
    [".ghost.danger:hover:not(:disabled)", "background", "var(--danger-background, color-mix(in oklab, var(--warn) 10%, transparent))"],
  ])("wraps the %s %s without changing its legacy fallback", (selector, prop, value) => {
    expect(finalDeclaration(selector, prop), `${selector} should declare ${prop}: ${value}`).toBe(value);
  });

  it("keeps enabled destructive hover feedback on the warning role", () => {
    expect(finalDeclaration(".ghost.danger:hover:not(:disabled)", "color")).toBe("var(--warn)");
    expect(finalDeclaration(".primary.danger:hover:not(:disabled)", "background")).toBe(
      "color-mix(in oklab, var(--warn) 85%, var(--text))",
    );
    expect(finalDeclaration(".primary.danger", "color")).toBe("var(--on-accent)");
  });

  it("wraps both colored coverage-gap stops without flattening its stripe", () => {
    expect(finalDeclaration(".coverageSeg.gap", "background")?.replace(/\s+/g, " ")).toBe(
      "repeating-linear-gradient( 45deg, var(--danger-background, color-mix(in oklab, var(--err) 25%, var(--panel))), var(--danger-background, color-mix(in oklab, var(--err) 25%, var(--panel))) 3px, var(--panel) 3px, var(--panel) 6px )",
    );
  });

  it("routes the live heat start through warning background and keeps its transparent endpoint", () => {
    const liveHeat = rulesInKeyframes(stylesCss, "liveHeat");
    const starts = liveHeat.filter((rule) => rule.selector === "0%").flatMap((rule) => rule.decls);
    const ends = liveHeat.filter((rule) => rule.selector === "100%").flatMap((rule) => rule.decls);
    expect(starts).toContainEqual({
      prop: "background",
      value: "var(--warning-background, color-mix(in oklab, var(--warn) 35%, transparent))",
    });
    expect(ends).toContainEqual({ prop: "background", value: "transparent" });
  });

  it("does not let another animation satisfy a named keyframe contract", () => {
    const liveHeat = rulesInKeyframes(
      `
        @keyframes decoy {
          0% { background: decoy-start; }
          100% { background: decoy-end; }
        }
        @keyframes liveHeat {
          0% { background: live-start; }
          100% { background: live-end; }
        }
      `,
      "liveHeat",
    );

    expect(liveHeat).toEqual([
      { selector: "0%", decls: [{ prop: "background", value: "live-start" }] },
      { selector: "100%", decls: [{ prop: "background", value: "live-end" }] },
    ]);
  });
});

describe("what a migrated control promises", () => {
  it("never lets a shorthand throw away a family named above it", () => {
    // What `.ghost` did: `font-family`, then `font: inherit` under it, and
    // the button came out in the page's reading face.
    const undone = sheet.filter((r) => {
      const family = r.decls.findIndex((d) => d.prop === "font-family");
      const shorthand = r.decls.map((d, i) => (d.prop === "font" ? i : -1)).filter((i) => i >= 0);
      return family >= 0 && shorthand.some((i) => i > family);
    });
    expect(undone.map((r) => r.selector)).toEqual([]);
  });

  it("names the family inside the shorthand wherever it states a role", () => {
    const loose = sheet.filter((r) =>
      r.decls.some(
        (d) =>
          d.prop === "font" &&
          /var\(--font-(page-title|section-title|body|control|caption)\)/.test(d.value) &&
          !/var\(--font-(ui|prose|mono|technical|display)\)/.test(d.value),
      ),
    );
    expect(loose.map((r) => r.selector)).toEqual([]);
  });

  it("takes a control's size from a token wherever it takes its height from one", () => {
    const heights = sheet.filter((r) => r.decls.some((d) => d.prop === "min-height" && /var\(--control-h/.test(d.value)));
    expect(heights.length).toBeGreaterThan(3);
    const literal = heights.filter((r) => r.decls.some((d) => /^font(-size)?$/.test(d.prop) && /\d*\.?\d+(rem|px|em)/.test(d.value)));
    expect(literal.map((r) => r.selector)).toEqual([]);
  });

  it("gives a shorter control the same word as a tall one", () => {
    // The design's 4.3: a compact control buys its room in height, never in
    // text size, and a dense row gains no size of its own.
    const compact = sheet.filter((r) => r.decls.some((d) => d.prop === "min-height" && /var\(--control-h-compact\)/.test(d.value)));
    expect(compact.length).toBeGreaterThan(1);
    const shrunk = compact.filter((r) => r.decls.some((d) => d.prop === "font-size" && d.value !== "var(--size-control)"));
    expect(shrunk.map((r) => r.selector)).toEqual([]);
  });

  it("draws the section label at the heading role rather than at a size of its own", () => {
    const labels = sheet.filter((r) => r.decls.some((d) => d.prop === "font" && /var\(--font-section-title\)/.test(d.value)));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect([label.selector, label.decls.some((d) => d.prop === "font-size")]).toEqual([label.selector, false]);
    }
  });

  it("uses the display family only for UI page titles and widget headings", () => {
    const display = sheet.filter((r) => r.decls.some((d) => /var\(--font-display\)/.test(d.value)));
    expect(display.map((r) => r.selector)).toEqual([
      ".widgetTitle",
      ":where(.pageHeader) h1",
      ".profileApplication > h2",
      ".marketHead h2",
    ]);
  });

  it("gives widget headings the active display voice at body size and lets long words wrap", () => {
    const widgetTitle = sheet.find((r) => r.selector === ".widgetTitle")!;
    expect(widgetTitle.decls).toContainEqual({ prop: "font", value: "var(--font-body) var(--font-display)" });
    expect(widgetTitle.decls).toContainEqual({ prop: "overflow-wrap", value: "anywhere" });
    expect(widgetTitle.decls.some((d) => /var\(--mono\)/.test(d.value))).toBe(false);
  });
});

describe("control font roles", () => {
  it("makes generic native controls follow UI rather than numeric", () => {
    expect(finalDeclaration("button, input, select, textarea", "font-family")).toBe("var(--font-ui)");
  });

  it.each([
    ".packBtn",
    ".chipLink",
    ".problemRow",
    ".roll",
    ".linkButton",
    ".inviteForm select",
    ".packBtnMain",
    ".disclose",
    ".renameTrigger",
    ".rowMenuPanel button",
    ".openTableRow",
    ".themeMenu select",
    ".chipAdd",
    ".matrix .cell",
    ".filtersToggle",
    ".alertPick select",
    ".docMenuItem",
    ".menuItem",
    ".fieldLabel",
    ".shelf > summary",
    ".themeMenu",
    ".more > summary",
    ".personaChip",
    ".runMenuBtn",
    ".owningTick",
    ".menuGroupLabel",
  ])("routes the %s label to the UI family", (selector) => {
    expect(finalDeclaration(selector, "font-family"), `${selector} should end in the UI family`).toBe("var(--font-ui)");
  });

  it("routes clickable chips to UI without changing static badges", () => {
    expect(finalDeclaration("button.chip", "font-family")).toBe("var(--font-ui)");
    expect(finalDeclaration("a.chip", "font-family")).toBe("var(--font-ui)");
    expect(finalDeclaration(".chip", "font-family")).toBe("var(--mono)");
  });

  it.each([
    ".libraryTitle",
    ".runRowMain",
    ".choice",
    ".tableLook .tableLine",
    ".renameInput",
    ".flowNow",
    ".setupOption",
    ".packBtn strong",
    ".packBtn span",
    ".packBtnMain strong",
    ".packBtnMain span",
    ".shelf summary strong",
    ".shelf .packBtn strong, .shelf .packBtnMain strong",
    ".shelf .packBtn span, .shelf .packBtnMain span",
  ])("routes the authored content in %s to the prose family", (selector) => {
    expect(finalDeclaration(selector, "font-family"), `${selector} should end in the prose family`).toBe("var(--font-prose)");
  });

  it("preserves explicit prose and mono control exceptions", () => {
    expect(finalDeclaration(".rollInput", "font-family")).toBe("var(--font-mono)");
    expect(finalDeclaration(".textInput.mono", "font-family")).toBe("var(--font-technical)");
    expect(finalDeclaration(".runNameInput", "font-family")).toBe("var(--font-prose)");
    expect(sheet.find((rule) => rule.selector === ".textInput.area")?.decls).toContainEqual({
      prop: "font",
      value: "var(--font-body) var(--font-prose)",
    });
  });

  it.each([
    [".purchaseKey", "font", "var(--font-caption) var(--font-technical)"],
    [".textInput.mono", "font-family", "var(--font-technical)"],
    [".incoming code, .incoming .mono", "font-family", "var(--font-technical)"],
    [".connectionsPanel code, .connectionsPanel .mono", "font-family", "var(--font-technical)"],
    [".licenseOrder", "font", "var(--font-caption) var(--font-technical)"],
    [".licenseKey", "font", "var(--font-body) var(--font-technical)"],
    [".log .timeline .where", "font-family", "var(--font-technical)"],
    [".brokeError", "font", "var(--font-caption) var(--font-technical)"],
    [
      ".profileApplication code, .profileApplication .mono, .profileApplication .mono.small, .profileApplication .muted.small.mono",
      "font-family",
      "var(--font-technical)",
    ],
    [".sealedPackPrompt .mono", "font-family", "var(--font-technical)"],
  ])("routes technical text in %s through its explicit role", (selector, prop, value) => {
    expect(finalDeclaration(selector, prop), `${selector} should declare ${prop}: ${value}`).toBe(value);
  });

  it.each([
    ".die .value",
    ".clockDigits",
    ".raceBoard .place",
    ".raceBoard .time",
    ".widgetBoard .place",
    ".widgetBoard .num",
    ".seatTracker > .num",
    ".rollTotal .big",
  ])("routes the unambiguous numeric readout in %s through the numeric role", (selector) => {
    expect(finalDeclaration(selector, "font-family")).toBe("var(--font-mono)");
  });

  it.each([".rollResult .headline", ".flowNow .idx", ".runRowMeta .num", ".tableLook .range"])(
    "keeps mixed or deferred metadata in %s on the legacy technical alias",
    (selector) => {
      expect(finalDeclaration(selector, "font-family")).toBe("var(--mono)");
    },
  );
});

describe("request action spacing", () => {
  it("separates the shared cancel action with the compact spacing token", () => {
    expect(finalDeclaration(".requestCancel", "margin-top")).toBe("var(--space-3)");
  });
});

describe("theme picker layout", () => {
  it("wraps and constrains the theme select inside its menu", () => {
    expect(sheet.find((r) => r.selector === ".themeMenu")?.decls).toContainEqual({ prop: "flex-wrap", value: "wrap" });
    expect(sheet.find((r) => r.selector === ".themeMenu select")?.decls).toContainEqual({ prop: "min-width", value: "0" });
    expect(sheet.find((r) => r.selector === ".themeMenu select")?.decls).toContainEqual({ prop: "max-width", value: "100%" });
  });
});
