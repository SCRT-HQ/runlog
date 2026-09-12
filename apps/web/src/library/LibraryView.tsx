import { useEffect, useMemo, useState } from "react";
import { loadPackText, type Pack, an } from "@runlog/rules-schema";
import { listRuns, type StoredPack, type StoredRun } from "../storage/db.ts";
import { syncBus } from "../sync/bus.ts";
import { useSync } from "../sync/SyncProvider.tsx";
import { activeRunFor } from "../run/active.ts";
import { RunRow, onDay } from "../run/RunRow.tsx";
import { scoresOf } from "../run/scores.ts";
import { byLastOpened, openedAt } from "./opened.ts";
import { DocMenu } from "../docs/DocMenu.tsx";
import { HomeStrip } from "./HomeStrip.tsx";
import { PackServers } from "./PackServers.tsx";
import { useGuildVaults } from "./useGuildVaults.ts";

/**
 * The library: your packs, newest-played first, each with its runs.
 *
 * One view that answers "what am I playing?". A pack is a card with its
 * runs beneath it, Continue on each, Start another, Forget, and the
 * order is what you played last on this device, so the pack you run most
 * nights is at the top with its open run one press away. Load-a-file lives
 * here too, and a pack of your own takes a newer file on its own row, its
 * runs kept. Nothing is a menu; everything is on the page.
 *
 * Nothing ships in it. The marketplace is where packs come from, and this view
 * is where the marketplace is reached from.
 */

export interface LibraryPack {
  id: string;
  title: string;
  /** A line under the title: where it came from, its version. */
  sub: string;
  source: string;
  /** The stored record, for the packs that are yours; none for a built-in. */
  record?: StoredPack;
  /** The marketplace's newer version of this pack, when it has one. */
  update?: string;
  /** Whether this is the test bench pack. */
  bench?: boolean;
}

const FALLBACK_VOCABULARY: Pack["vocabulary"] = {
  unit: { one: "Unit", many: "Units" },
  subject: { one: "Piece", many: "Pieces" },
  run: { one: "Run", many: "Runs" },
} as Pack["vocabulary"];

export function LibraryView({
  packs,
  activeId,
  onOpen,
  onContinue,
  onStartAnother,
  onTest,
  onForgetRun,
  onForgetPack,
  onFile,
  onSyncToggle,
  onMarketplace,
  onUpdate,
  onReplace,
  onJoinRace,
  onContinueLast,
}: {
  packs: LibraryPack[];
  activeId: string;
  onOpen: (pack: LibraryPack) => void;
  onContinue: (pack: LibraryPack, run: StoredRun) => void;
  onStartAnother: (pack: LibraryPack) => void;
  /** Play it without keeping anything: to see how it goes, or to test it. */
  onTest?: (pack: LibraryPack) => void;
  onForgetRun: (run: StoredRun) => void;
  onForgetPack: (record: StoredPack) => void;
  onFile: (file: File | undefined) => void;
  onSyncToggle: (record: StoredPack, on: boolean) => void;
  onMarketplace: () => void;
  /** Take the marketplace's newer version of a pack. */
  onUpdate?: (record: StoredPack) => void;
  /** Take a newer file of a pack already here; its runs stay. Not for a sealed copy. */
  onReplace?: (record: StoredPack, file: File | undefined) => void;
  /** Join a race by its six-letter code; absent where nobody is signed in. */
  onJoinRace?: (code: string) => void;
  /** Open the run this account touched last, on this device or another. */
  onContinueLast?: (runId?: string) => void;
}) {
  const [raceCode, setRaceCode] = useState("");
  // Which servers may play what, read once for the shelf; empty where
  // there is no bot behind this copy or nobody signed in.
  const vaults = useGuildVaults();
  const sync = useSync();
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const reload = () => void listRuns().then((all) => setRuns(all.filter((r) => !r.deletedAt)));
  useEffect(() => {
    reload();
    return syncBus.subscribe((news) => {
      if (news.kind === "run") reload();
    });
  }, []);

  const ordered = useMemo(() => byLastOpened(packs), [packs]);

  /** Each pack, fully parsed, once per source: its words for the rows, and enough to score them. */
  const parsedPacks = useMemo(() => {
    const out = new Map<string, Pack>();
    for (const p of packs) {
      const parsed = loadPackText(p.source, p.record?.format ?? "yaml");
      if (parsed.ok) out.set(p.id, parsed.pack);
    }
    return out;
  }, [packs]);

  const vocabularies = useMemo(() => {
    const out = new Map<string, Pack["vocabulary"]>();
    for (const p of packs) out.set(p.id, parsedPacks.get(p.id)?.vocabulary ?? FALLBACK_VOCABULARY);
    return out;
  }, [packs, parsedPacks]);

  const runsOf = (packId: string) =>
    runs.filter((r) => r.packId === packId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  /** Score text for an ended run, by pack: a pack that failed to parse scores nothing. */
  const scoresByPack = useMemo(() => {
    const out = new Map<string, Map<string, string>>();
    for (const [id, pack] of parsedPacks) {
      out.set(id, new Map(scoresOf(pack, runsOf(id), Date.now()).map((s) => [s.runId, s.text])));
    }
    return out;
  }, [parsedPacks, runs]);

  return (
    <main className="main library">
      <header className="libraryHead">
        <h2>Your packs</h2>
        <p className="muted">
          Newest played first. A pack's runs are beneath it; the one open on this device is marked.
        </p>
        <div className="libraryActions">
          <div className="libraryActionGroup">
            <h3 className="sectionTitle">Add a pack</h3>
            <div className="libraryActionGroupRow">
              <button className="primary" onClick={onMarketplace}>
                Get more packs
              </button>
              <label className="ghost fileButton">
                Load a pack from a file
                <input type="file" accept=".yaml,.yml,.json,.rlpack" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
          </div>
          {onJoinRace && (
            <div className="libraryActionGroup">
              <h3 className="sectionTitle">Join a race</h3>
              <form
                className="raceJoin"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (raceCode.trim().length >= 6) {
                    onJoinRace(raceCode.trim());
                    setRaceCode("");
                  }
                }}
              >
                <input
                  className="textInput code"
                  value={raceCode}
                  placeholder="race code"
                  maxLength={8}
                  aria-label="A race code, six letters"
                  onChange={(e) => setRaceCode(e.target.value.toUpperCase())}
                />
                <button className="ghost" type="submit" disabled={raceCode.trim().length < 6}>
                  Join a race
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      <HomeStrip packs={ordered} runs={runs} vocabularies={vocabularies} onContinue={onContinue} onContinueLast={onContinueLast} onOpen={onOpen} onMarketplace={onMarketplace} />

      {ordered.length === 0 && (
        <section className="panel">
          <p>No packs here yet. Pick one from the marketplace, or load one of your own from a file.</p>
        </section>
      )}

      {ordered.map((p) => {
        const v = vocabularies.get(p.id) ?? FALLBACK_VOCABULARY;
        const mine = runsOf(p.id);
        const open = activeRunFor(p.id);
        const last = openedAt(p.id);
        const record = p.record;
        return (
          <section key={p.id} className={`panel libraryPack ${p.id === activeId ? "inPlay" : ""}`}>
            <div className="libraryPackHead">
              <button className="libraryTitle" onClick={() => onOpen(p)} title={`Open ${p.title}`}>
                <strong>{p.title}</strong>
                {p.bench && <span className="chip cap">test bench</span>}
                <span className="muted small">
                  {p.sub}
                  {last && ` · played ${onDay(last)}`}
                  {p.id === activeId && " · in play"}
                </span>
              </button>
              <div className="libraryPackActions">
                {record && p.update && onUpdate && (
                  <button className="ghost tiny update" onClick={() => onUpdate(record)} title={`The marketplace has v${p.update}; your ${v.run.many.toLowerCase()} are kept`}>
                    Update to v{p.update}
                  </button>
                )}
                <DocMenu compact pack={() => loadPackText(p.source, p.record?.format ?? "yaml").pack} />
                <button className="ghost tiny" onClick={() => onStartAnother(p)}>
                  {mine.length > 0 ? `Start another ${v.run.one.toLowerCase()}` : `Start ${an(v.run.one.toLowerCase())}`}
                </button>
                {onTest && (
                  <button className="ghost tiny" onClick={() => onTest(p)} title={`Play ${p.title} in ${an(v.run.one.toLowerCase())} that is not saved`}>
                    Test
                  </button>
                )}
                {/* Where this pack may be played, answered at the shelf
                    rather than from each server's own page. */}
                {record && <PackServers pack={record} vaults={vaults} />}
                {record && !record.sealed && onReplace && (
                  <label className="ghost tiny fileButton" title={`Load a newer file of ${p.title}; its ${v.run.many.toLowerCase()} are kept`}>
                    Replace from a file
                    <input
                      type="file"
                      accept=".yaml,.yml,.json"
                      onChange={(e) => {
                        onReplace(record, e.target.files?.[0]);
                        // So the same file, fixed and chosen again, counts as a change.
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                {record && (
                  <button className="ghost tiny danger" title={`Forget ${p.title} and its ${v.run.many.toLowerCase()}`} onClick={() => onForgetPack(record)}>
                    Forget pack
                  </button>
                )}
              </div>
            </div>

            {mine.length > 0 && (
              <div className="runList">
                {mine.map((r) => (
                  <RunRow
                    key={r.runId}
                    run={r}
                    vocabulary={v}
                    open={r.runId === open && p.id === activeId}
                    score={scoresByPack.get(p.id)?.get(r.runId)}
                    onPick={() => onContinue(p, r)}
                    onForget={() => onForgetRun(r)}
                  />
                ))}
              </div>
            )}

            {record && sync.available && (
              record.sealed ? (
                <p className="packSync muted">license key kept in your account; the text stays on this device</p>
              ) : (
                <label className="packSync" title="Its text is stored in your account and comes to your other devices">
                  <input type="checkbox" checked={record.sync === true} onChange={(e) => onSyncToggle(record, e.target.checked)} />
                  <span>keep this pack in sync</span>
                </label>
              )
            )}
          </section>
        );
      })}
    </main>
  );
}
