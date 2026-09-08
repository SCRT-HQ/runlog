import { useEffect, useMemo, useState } from "react";
import { loadPackText, type Pack, an } from "@runlog/rules-schema";
import { listRuns, type StoredPack, type StoredRun } from "../storage/db.ts";
import { syncBus } from "../sync/bus.ts";
import { useSync } from "../sync/SyncProvider.tsx";
import { activeRunFor } from "../run/active.ts";
import { RunRow, onDay } from "../run/RunRow.tsx";
import { byLastOpened, openedAt } from "./opened.ts";
import { DocMenu } from "../docs/DocMenu.tsx";
import { HomeStrip } from "./HomeStrip.tsx";

/**
 * The library: your packs, newest-played first, each with its runs.
 *
 * One view that answers "what am I playing?". A pack is a card with its
 * runs beneath it — Continue on each, Start another, Forget — and the
 * order is what you played last on this device, so the pack you run most
 * nights is at the top with its open run one press away. Load-a-file lives
 * here too. Nothing is a menu; everything is on the page.
 *
 * Nothing ships in it. The catalog is where packs come from, and this view
 * is where the catalog is reached from.
 */

export interface LibraryPack {
  id: string;
  title: string;
  /** A line under the title: where it came from, its version. */
  sub: string;
  source: string;
  /** The stored record, for the packs that are yours; none for a built-in. */
  record?: StoredPack;
  /** The catalog's newer version of this pack, when it has one. */
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
  onCatalog,
  onUpdate,
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
  onCatalog: () => void;
  /** Take the catalog's newer version of a pack. */
  onUpdate?: (record: StoredPack) => void;
  /** Join a race by its six-letter code; absent where nobody is signed in. */
  onJoinRace?: (code: string) => void;
  /** Open the run this account touched last, on this device or another. */
  onContinueLast?: () => void;
}) {
  const [raceCode, setRaceCode] = useState("");
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

  /** Each pack's own words, for its rows; parsed once per source. */
  const vocabularies = useMemo(() => {
    const out = new Map<string, Pack["vocabulary"]>();
    for (const p of packs) {
      const parsed = loadPackText(p.source, p.record?.format ?? "yaml");
      out.set(p.id, parsed.ok ? parsed.pack.vocabulary : FALLBACK_VOCABULARY);
    }
    return out;
  }, [packs]);

  const runsOf = (packId: string) =>
    runs.filter((r) => r.packId === packId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

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
              <button className="primary" onClick={onCatalog}>
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

      <HomeStrip packs={ordered} runs={runs} vocabularies={vocabularies} onContinue={onContinue} onContinueLast={onContinueLast} onOpen={onOpen} onCatalog={onCatalog} />

      {ordered.length === 0 && (
        <section className="panel">
          <p>No packs here yet. Pick one from the catalog, or load one of your own from a file.</p>
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
                  <button className="ghost tiny update" onClick={() => onUpdate(record)} title={`The catalog has v${p.update}; your ${v.run.many.toLowerCase()} are kept`}>
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
