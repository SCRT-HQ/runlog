import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Pack } from "@runlog/rules-schema";
import { RacePanel } from "./RacePanel.tsx";
import type { RaceView } from "./useRace.ts";

const pack = { vocabulary: { unit: { one: "Stage", many: "Stages" }, run: { one: "Firing", many: "Firings" } } } as unknown as Pack;
const race = {
  race: { meta: { name: "Kiln race" }, entries: [{}, {}] },
  standings: [
    { entry: { sub: "me", name: "Nate", progress: { unit: 2, unitsDone: 1, status: "active", elapsedMs: 60_000 } }, place: 1, me: true },
    { entry: { sub: "jo", name: "Jo" }, place: 2, me: false },
  ],
  owner: false,
  busy: false,
} as unknown as RaceView;

describe("the race panel in the app", () => {
  it("puts a 'you' chip on your own row, as the members list does", () => {
    const html = renderToStaticMarkup(<RacePanel runId="r1" pack={pack} race={race} />);
    expect(html).toContain('<li class="me" aria-current="true">');
    expect(html).toContain('Nate<span class="chip you">you</span>');
    expect(html.match(/chip you/g)).toHaveLength(1);
  });
});
