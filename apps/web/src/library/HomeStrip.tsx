import { useEffect, useMemo, useState } from "react";
import { rankRace } from "@runlog/engine";
import type { Pack } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import type { StoredRun } from "../storage/db.ts";
import { useApi } from "../sync/useApi.ts";
import type { Race } from "../sync/client.ts";
import { lastActive } from "../run/active.ts";
import { hasEnded, onDay } from "../run/RunRow.tsx";
import { Button } from "../ui/Button.tsx";
import { loadMarketplace, type MarketplaceEntry } from "./marketplace.ts";
import { elsewhere, pickUp, runLine, runTitle } from "./home.ts";

/**
 * Where you left off, at the top of the shelf.
 *
 * One card, first on the page, on its own row: the run to pick up, or, on
 * a device that has played nothing yet, the pack to start. A race the
 * account is in follows it, because a race is play in progress too.
 * Discovery is not here; it sits under the packs, in `DiscoverStrip`,
 * where a shelf of your own comes first and what you might add comes
 * after.
 *
 * The continue card is this device's own run, Pick up, in review, kept
 * coming back as the same run the account card opened, so the two were
 * merged into one. Where the account's last-touched run is a different
 * run than this device's (played from somewhere else since), a quiet
 * second line inside the same card offers it too.
 */
export function HomeStrip<P extends { id: string; title: string }>({
  packs,
  runs,
  vocabularies,
  onContinue,
  onContinueLast,
  onOpen,
}: {
  packs: readonly P[];
  runs: readonly StoredRun[];
  vocabularies: ReadonlyMap<string, Pack["vocabulary"]>;
  onContinue: (pack: P, run: StoredRun) => void;
  /** The account's last run, wherever it was touched; absent where nobody is signed in. */
  /** Open a run of the account's that this device is not on; with no id, whatever was last active here. */
  onContinueLast?: (runId?: string) => void;
  onOpen: (pack: P) => void;
}) {
  const account = useAccount();
  const api = useApi();
  const me = account.status === "signed-in" ? account.user.id : null;
  const [races, setRaces] = useState<Race[]>([]);
  const [accountRunId, setAccountRunId] = useState<string | null>(null);

  const up = useMemo(() => pickUp(packs, runs, lastActive()), [packs, runs]);
  const other = useMemo(() => elsewhere(packs, runs, up, accountRunId), [packs, runs, up, accountRunId]);

  // The account's own last-touched run, whichever device left it there; only
  // fetched to compare against what this device already offers.
  useEffect(() => {
    if (!api || !me) {
      setAccountRunId(null);
      return;
    }
    let live = true;
    void api.me().then(
      (it) => live && setAccountRunId(it.profile.currentSessionId ?? null),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, me]);

  // The account's races, once per visit; only the ones still running.
  useEffect(() => {
    if (!api || !me) {
      setRaces([]);
      return;
    }
    let live = true;
    void api.myRaces().then(
      (all) => live && setRaces(all.filter((r) => !r.meta.endedAt)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, me]);

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

  if (!up && standings.length === 0) return null;

  // The run the card points at may be over. `pickUp` still chooses it, and
  // the press still opens it; what changes is what the card promises,
  // because a run that has ended has results to read and no more play in it.
  const over = up?.run ? hasEnded(up.run) : false;

  return (
    <section className="homeStrip" aria-label="Where you are">
      {up && (
        <div className="panel homeCard">
          <span className="homeLabel muted small">{up.run ? "Continue where you left off" : "Start"}</span>
          <strong>{up.run ? runTitle(up.run, vocabularies.get(up.pack.id)?.run.one ?? "Run") : up.pack.title}</strong>
          <span className="muted small">
            {up.run
              ? `${runLine(up.run, vocabularies.get(up.pack.id)?.unit.one ?? "Unit")} · ${onDay(up.run.updatedAt)}${over ? " · ended" : ""}`
              : "Nothing played yet; a first run is one press away."}
          </span>
          <div className="padRow">
            {up.run ? (
              <Button variant="primary" onClick={() => onContinue(up.pack, up.run!)}>
                {over ? "View results" : "Continue"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => onOpen(up.pack)}>
                Start
              </Button>
            )}
          </div>
          {other && onContinueLast && (
            <div className="homeElsewhere muted small">
              <span>Elsewhere on your account: {runLine(other.run!, vocabularies.get(other.pack.id)?.unit.one ?? "Unit")}</span>
              <Button size="compact" onClick={() => onContinueLast(other.run!.runId)}>
                Open
              </Button>
            </div>
          )}
        </div>
      )}
      {standings.map((s) => (
        <div key={s.race.meta.id} className="panel homeCard">
          <span className="homeLabel muted small">Race{s.race.meta.name ? ` · ${s.race.meta.name}` : ""}</span>
          <strong>
            #{s.place} of {s.of}
          </strong>
          <span className="muted small">
            {s.race.meta.packTitle ?? s.race.meta.packId} · code {s.race.meta.code}
          </span>
          {s.run && s.pack && (
            <div className="padRow">
              <Button onClick={() => onContinue(s.pack!, s.run!)}>Keep racing</Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * What you do not have yet: the page that says what Runlog is, on a
 * device that has played nothing, and what the marketplace has that this
 * shelf does not.
 *
 * It used to be half of the strip at the top. It belongs under the packs:
 * a person opening the library owns something already, and being offered
 * somebody else's pack before your own is the thing that put your
 * collection below the fold on a phone.
 */
export function DiscoverStrip<P extends { id: string }>({
  packs,
  runs,
  onMarketplace,
}: {
  packs: readonly P[];
  runs: readonly StoredRun[];
  onMarketplace: () => void;
}) {
  // Nothing played yet: the page that says what this is.
  const welcome = runs.length === 0 ? import.meta.env.BASE_URL : null;
  const [fresh, setFresh] = useState<MarketplaceEntry[]>([]);

  // What the marketplace has that the shelf does not: published packs first, three at most.
  useEffect(() => {
    let live = true;
    const here = new Set(packs.map((p) => p.id));
    void loadMarketplace().then((all) => {
      if (!live) return;
      // The test bench is never "new" here, whether or not this copy shows
      // it in the marketplace at all, it is not a pack anyone is meant to
      // stumble into.
      const out = all.filter((e) => !here.has(e.id) && !e.bench);
      out.sort((a, b) => (a.source === b.source ? 0 : a.source === "listing" ? -1 : 1));
      setFresh(out.slice(0, 3));
    });
    return () => {
      live = false;
    };
  }, [packs]);

  if (!welcome && fresh.length === 0) return null;

  return (
    <div className="homeStrip">
      {fresh.length > 0 && (
        <div className="panel homeCard">
          <span className="homeLabel muted small">New in the marketplace</span>
          <ul className="homeList">
            {fresh.map((e) => (
              <li key={e.id}>
                <button className="linkButton" onClick={onMarketplace} title={e.description ?? e.blurb}>
                  {e.title}
                </button>
                <span className="muted small"> · {e.price === "free" ? "free" : e.price.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {welcome && (
        <div className="panel homeCard">
          <span className="homeLabel muted small">New here?</span>
          <strong>What Runlog is</strong>
          <span className="muted small">
            A referee and a run log for games played around the things you already do. One page says the rest.
          </span>
          <div className="padRow">
            <a className="ghost" href={welcome}>
              Read it
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
