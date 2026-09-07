import { useEffect, useMemo, useState } from "react";
import { rankRace } from "@runlog/engine";
import type { Pack } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import type { StoredRun } from "../storage/db.ts";
import { useApi } from "../sync/useApi.ts";
import type { Race } from "../sync/client.ts";
import { lastActive } from "../run/active.ts";
import { onDay } from "../run/RunRow.tsx";
import { loadCatalog, type CatalogEntry } from "./catalog.ts";
import { pickUp, runLine } from "./home.ts";

/**
 * The strip above the shelf: where to pick up, how a race stands, and
 * what is new in the catalog. Three small panels, each shown only when
 * it has something to say, so a fresh device sees one card (start the
 * pack it came with) and a busy one sees three. Nothing here is a
 * second copy of the shelf; each card is one press to somewhere.
 */
export function HomeStrip<P extends { id: string; title: string }>({
  packs,
  runs,
  vocabularies,
  onContinue,
  onOpen,
  onCatalog,
}: {
  packs: readonly P[];
  runs: readonly StoredRun[];
  vocabularies: ReadonlyMap<string, Pack["vocabulary"]>;
  onContinue: (pack: P, run: StoredRun) => void;
  onOpen: (pack: P) => void;
  onCatalog: () => void;
}) {
  const account = useAccount();
  const api = useApi();
  // Nothing played yet: the page that says what this is.
  const welcome = runs.length === 0 ? "./" : null;
  const me = account.status === "signed-in" ? account.user.id : null;
  const [races, setRaces] = useState<Race[]>([]);
  const [fresh, setFresh] = useState<CatalogEntry[]>([]);

  const up = useMemo(() => pickUp(packs, runs, lastActive()), [packs, runs]);

  // The account's races, once per visit; only the ones still running.
  useEffect(() => {
    if (!api || !me) {
      setRaces([]);
      return;
    }
    let live = true;
    void api.myRaces().then((all) => live && setRaces(all.filter((r) => !r.meta.endedAt)), () => {});
    return () => {
      live = false;
    };
  }, [api, me]);

  // What the catalog has that the shelf does not: published packs first, three at most.
  useEffect(() => {
    let live = true;
    const here = new Set(packs.map((p) => p.id));
    void loadCatalog().then((all) => {
      if (!live) return;
      const out = all.filter((e) => !here.has(e.id));
      out.sort((a, b) => (a.source === b.source ? 0 : a.source === "listing" ? -1 : 1));
      setFresh(out.slice(0, 3));
    });
    return () => {
      live = false;
    };
  }, [packs]);

  const standings = races
    .map((race) => {
      const ranked = rankRace(race.entries);
      const mine = ranked.find((s) => s.entry.sub === me);
      if (!mine) return null;
      const run = mine.entry.sessionId ? runs.find((r) => r.runId === mine.entry.sessionId && !r.deletedAt) : undefined;
      const pack = run ? packs.find((p) => p.id === run.packId) : undefined;
      return { race, place: mine.place, of: ranked.length, run, pack };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .slice(0, 2);

  if (!up && standings.length === 0 && fresh.length === 0 && !welcome) return null;

  return (
    <section className="homeStrip" aria-label="Where you are">
      {welcome && (
        <div className="panel homeCard">
          <span className="homeLabel muted small">New here?</span>
          <strong>What Runlog is</strong>
          <span className="muted small">A referee and a run log for games played around the things you already do. One page says the rest.</span>
          <div className="padRow">
            <a className="ghost" href={welcome}>
              Read it
            </a>
          </div>
        </div>
      )}
      {up && (
        <div className="panel homeCard">
          <span className="homeLabel muted small">{up.run ? "Pick up" : "Start"}</span>
          <strong>{up.pack.title}</strong>
          <span className="muted small">
            {up.run ? `${runLine(up.run, vocabularies.get(up.pack.id)?.unit.one ?? "Unit")} · ${onDay(up.run.updatedAt)}` : "Nothing played yet; a first run is one press away."}
          </span>
          <div className="padRow">
            {up.run ? (
              <button className="primary" onClick={() => onContinue(up.pack, up.run!)}>
                Continue
              </button>
            ) : (
              <button className="primary" onClick={() => onOpen(up.pack)}>
                Play
              </button>
            )}
          </div>
        </div>
      )}
      {standings.map((s) => (
        <div key={s.race.meta.id} className="panel homeCard">
          <span className="homeLabel muted small">Race{s.race.meta.name ? ` · ${s.race.meta.name}` : ""}</span>
          <strong>
            #{s.place} of {s.of}
          </strong>
          <span className="muted small">{s.race.meta.packTitle ?? s.race.meta.packId} · code {s.race.meta.code}</span>
          {s.run && s.pack && (
            <div className="padRow">
              <button className="ghost" onClick={() => onContinue(s.pack!, s.run!)}>
                Keep racing
              </button>
            </div>
          )}
        </div>
      ))}
      {fresh.length > 0 && (
        <div className="panel homeCard">
          <span className="homeLabel muted small">New in the catalog</span>
          <ul className="homeList">
            {fresh.map((e) => (
              <li key={e.id}>
                <button className="linkButton" onClick={onCatalog} title={e.description ?? e.kind}>
                  {e.title}
                </button>
                <span className="muted small"> · {e.price === "free" ? "free" : e.price.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
