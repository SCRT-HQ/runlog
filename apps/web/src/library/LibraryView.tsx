import { useEffect, useMemo, useRef, useState } from "react";
import { DOC_KINDS, loadPackText, type Pack, an } from "@runlog/rules-schema";
import { DEVICES, DEVICE_IDS, hasKeys } from "@runlog/deck-profiles";
import { listRuns, type StoredPack, type StoredRun } from "../storage/db.ts";
import { syncBus } from "../sync/bus.ts";
import { useSync } from "../sync/SyncProvider.tsx";
import { activeRunFor } from "../run/active.ts";
import { RunRow, hasEnded, onDay } from "../run/RunRow.tsx";
import { scoresOf } from "../run/scores.ts";
import { byLastOpened, openedAt } from "./opened.ts";
import { useDocDrawer } from "../docs/DocDrawer.tsx";
import { downloadProfile } from "./DeckProfiles.tsx";
import { DiscoverStrip, HomeStrip } from "./HomeStrip.tsx";
import { PackServers } from "./PackServers.tsx";
import { useGuildVaults, type GuildVaults } from "./useGuildVaults.ts";
import { profileHash } from "../profile/route.ts";
import { keepSetup, readDocumentFile } from "../storage/documents.ts";
import { useTitle } from "../title.ts";
import { Button } from "../ui/Button.tsx";
import { Menu, MenuGroup, MenuItem, MenuRule } from "../ui/Menu.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";

/**
 * The library: where you left off, then your packs, then everything else.
 *
 * One view that answers "what am I playing?", in that order. The
 * continuation card is first and on its own row, so the press most people
 * came for is in the first screenful of a phone. Then the packs, newest
 * played first, each a card with its runs beneath it. Adding a pack,
 * joining a race and what the marketplace has new are grouped after them,
 * because discovery follows what you already own.
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
  seats,
  onTakeSeat,
  onOpenSettings,
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
  /** Runs this account plays without holding the pack: a seat rather than a copy. */
  seats?: StoredRun[];
  onTakeSeat?: (run: StoredRun) => void;
  /** Open the profile's Settings page, where the setups are kept. */
  onOpenSettings?: () => void;
}) {
  useTitle("Packs");
  const [raceCode, setRaceCode] = useState("");
  /** What became of a file chosen here that turned out to be a setup: `kept`, or why it did not load. */
  const [setupNote, setSetupNote] = useState<string | null>(null);
  // Which servers may play what, read once for the shelf; empty where
  // there is no bot behind this copy or nobody signed in.
  const vaults = useGuildVaults();
  const sync = useSync();
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const reload = () => void listRuns().then((all) => setRuns(all.filter((r) => !r.deletedAt)));
  useEffect(() => {
    reload();
    return syncBus.subscribe((news) => {
      if ((news.t === "localChange" || news.t === "pulled") && news.kind === "run") reload();
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

  /** The way to Settings, pressed or followed: the address is real, so it survives a reload. */
  const toSettings = (text: string) => (
    <a
      href={profileHash("settings")}
      onClick={(e) => {
        if (!onOpenSettings) return;
        e.preventDefault();
        onOpenSettings();
      }}
    >
      {text}
    </a>
  );

  /*
   * A file chosen at Load a pack from a file.
   *
   * It may be a setup. Somebody who has one and is looking at this page
   * has one door in front of them, and being told their good file is the
   * wrong kind of document teaches them nothing: the setups section takes
   * a pack the same way, and this is the other half of that.
   */
  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setSetupNote(null);
    // A sealed copy is binary and is nobody's setup, so it goes straight
    // to the pack door rather than through a parse of its bytes.
    if (!/\.rlpack$/i.test(file.name)) {
      const doc = await readDocumentFile(file);
      if (doc.kind === "setup") {
        const result = await keepSetup(doc.text, doc.format, file.name);
        setSetupNote(result.ok ? "kept" : result.message);
        return;
      }
    }
    onFile(file);
  };

  const runsOf = (packId: string) => runs.filter((r) => r.packId === packId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

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
      <PageHeader
        className="libraryHead"
        title="Your packs"
        lead="Newest played first. A pack's runs are beneath it; the one open on this device is marked."
      />

      <HomeStrip
        packs={ordered}
        runs={runs}
        vocabularies={vocabularies}
        onContinue={onContinue}
        onContinueLast={onContinueLast}
        onOpen={onOpen}
      />

      {ordered.length === 0 && (
        <section className="panel">
          <p>No packs here yet. Pick one from the marketplace, or load one of your own from a file.</p>
        </section>
      )}

      {ordered.map((p) => (
        <PackCard
          key={p.id}
          pack={p}
          vocabulary={vocabularies.get(p.id) ?? FALLBACK_VOCABULARY}
          parsed={parsedPacks.get(p.id)}
          runs={runsOf(p.id)}
          scores={scoresByPack.get(p.id)}
          inPlay={p.id === activeId}
          openRunId={activeRunFor(p.id)}
          vaults={vaults}
          syncAvailable={sync.available}
          onOpen={onOpen}
          onContinue={onContinue}
          onStartAnother={onStartAnother}
          onForgetRun={onForgetRun}
          onForgetPack={onForgetPack}
          onSyncToggle={onSyncToggle}
          {...(onTest ? { onTest } : {})}
          {...(onUpdate ? { onUpdate } : {})}
          {...(onReplace ? { onReplace } : {})}
        />
      ))}

      {/*
        Adding a pack, joining a race and what the marketplace has new:
        one group, under the shelf. Every one of them is about content
        that is not yours yet, and on a phone they used to stand between
        the top of the page and the pack you came to play.
      */}
      <section className="libraryAdd" aria-labelledby="libraryAddTitle">
        <h2 className="sectionTitle" id="libraryAddTitle">
          Add and discover
        </h2>
        <div className="libraryActions">
          {/* No title over these two: the section above says Add, and
              saying it again on the next line says nothing. The accent
              is not here either. It marks the one action the page wants
              pressed, and that is the card at the top. */}
          <div className="libraryActionGroup">
            <div className="libraryActionGroupRow">
              <Button onClick={onMarketplace}>Get more packs</Button>
              <label className="ghost fileButton">
                Load a pack from a file
                <input type="file" accept=".yaml,.yml,.json,.rlpack" onChange={(e) => void takeFile(e.target.files?.[0])} />
              </label>
            </div>
            {setupNote && <p className="notice librarySetups">{setupNote === "kept" ? toSettings("Kept under Settings.") : setupNote}</p>}
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
                <Button type="submit" disabled={raceCode.trim().length < 6}>
                  Join a race
                </Button>
              </form>
            </div>
          )}
        </div>
        <DiscoverStrip packs={ordered} runs={runs} onMarketplace={onMarketplace} />
      </section>

      {seats && seats.length > 0 && onTakeSeat && (
        <section className="panel packCard">
          <h2>Seats</h2>
          <p className="muted small">Runs you play on somebody else's copy of the pack.</p>
          <div className="runList">
            {seats.map((r) => (
              <div key={r.runId} className="runRow">
                <button className="runRowMain" onClick={() => onTakeSeat(r)}>
                  <strong>{r.packTitle ?? r.packId}</strong>
                  <span className="muted small runRowMeta">
                    <span>last played {onDay(r.updatedAt)} · you play</span>
                  </span>
                </button>
                <span className="runRowActions">
                  <Button size="compact" onClick={() => onTakeSeat(r)}>
                    Take your seat
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/*
        The door the shelf left behind. The setups somebody keeps are
        managed under Settings now, with the rest of what is kept rather
        than played; all that is left here is where they went, for
        anybody who goes looking where they used to be. Phase 6 takes
        this line out if nobody misses it.
      */}
      <p className="muted small librarySetups">{toSettings("Your setups are under Settings.")}</p>
    </main>
  );
}

/**
 * One pack, as a card: what it is, the one thing to press, and the
 * errands folded away behind More.
 *
 * The card used to lay out Documents, Stream Deck profile, Start another,
 * Test, Every server, Replace from a file and Forget pack in one row, all
 * the same size, so the press nearly everybody came for was one of seven.
 * Now it is one: Continue, on the run that is open or the latest one not
 * finished, else Start. Everything else is a line in the menu, with
 * Forget at the foot behind a rule.
 *
 * Two things stay in sight beside it, and neither is decoration: a newer
 * version waiting in the marketplace, which is worth taking before the
 * next run rather than after it, and the servers this pack may be played
 * in, which is a fact about who may play rather than an errand. The
 * design is explicit that what changes the next press does not go behind
 * an ellipsis.
 */
function PackCard({
  pack: p,
  vocabulary: v,
  parsed,
  runs: mine,
  scores,
  inPlay,
  openRunId,
  vaults,
  syncAvailable,
  onOpen,
  onContinue,
  onStartAnother,
  onTest,
  onForgetRun,
  onForgetPack,
  onUpdate,
  onReplace,
  onSyncToggle,
}: {
  pack: LibraryPack;
  vocabulary: Pack["vocabulary"];
  /** The pack, read; absent where its text does not parse, which costs the card its documents and its deck. */
  parsed?: Pack;
  /** The runs of this pack, newest first. */
  runs: StoredRun[];
  scores?: Map<string, string>;
  inPlay: boolean;
  openRunId: string | null;
  vaults: GuildVaults;
  syncAvailable: boolean;
  onOpen: (pack: LibraryPack) => void;
  onContinue: (pack: LibraryPack, run: StoredRun) => void;
  onStartAnother: (pack: LibraryPack) => void;
  onTest?: (pack: LibraryPack) => void;
  onForgetRun: (run: StoredRun) => void;
  onForgetPack: (record: StoredPack) => void;
  onUpdate?: (record: StoredPack) => void;
  onReplace?: (record: StoredPack, file: File | undefined) => void;
  onSyncToggle: (record: StoredPack, on: boolean) => void;
}) {
  /** The rest of the runs, once somebody has asked for them. */
  const [everyRun, setEveryRun] = useState(false);
  /** The decks, under the line that offers them. */
  const [decks, setDecks] = useState(false);
  const drawer = useDocDrawer();
  const file = useRef<HTMLInputElement>(null);
  const record = p.record;
  const runOne = v.run.one.toLowerCase();
  const runMany = v.run.many.toLowerCase();
  const last = openedAt(p.id);

  // What Continue continues: the run open on this device, else the most
  // recent one that has not ended. A shelf of finished runs starts a new
  // one instead of promising play on a run that is over.
  const openRun = inPlay ? mine.find((r) => r.runId === openRunId) : undefined;
  const resume = openRun ?? mine.find((r) => !hasEnded(r));
  const shown = everyRun ? mine : mine.slice(0, 3);
  /** A pack with nothing to put on a deck is offered no deck. */
  const deck = parsed && hasKeys(parsed) ? parsed : null;

  return (
    <section className={`panel libraryPack ${inPlay ? "inPlay" : ""}`}>
      <div className="libraryPackHead">
        <button className="libraryTitle" onClick={() => onOpen(p)} title={`Open ${p.title}`}>
          <strong>{p.title}</strong>
          {p.bench && <span className="chip cap">test bench</span>}
          <span className="muted small">
            {p.sub}
            {last && ` · played ${onDay(last)}`}
            {inPlay && " · in play"}
          </span>
        </button>
        <div className="libraryPackActions">
          {record && p.update && onUpdate && (
            <Button
              size="compact"
              className="update"
              onClick={() => onUpdate(record)}
              title={`The marketplace has v${p.update}; your ${runMany} are kept`}
            >
              Update to v{p.update}
            </Button>
          )}
          {/* Where this pack may be played, answered at the shelf
              rather than from each server's own page. */}
          {record && <PackServers pack={record} vaults={vaults} />}
          {/* The card's one action, and it is quiet. The accent belongs to
              the page's single filled action, which is the card at the top;
              a shelf of six packs filling six buttons is six answers to one
              question. Where this sits, at the card's right edge with the
              menu beside it, is what says it is the card's action. */}
          {resume ? (
            <Button size="compact" onClick={() => onContinue(p, resume)}>
              Continue
            </Button>
          ) : (
            <Button size="compact" onClick={() => onStartAnother(p)}>
              {`Start ${an(runOne)}`}
            </Button>
          )}
          <Menu label="More">
            {(close) => (
              <>
                {parsed && (
                  <MenuGroup label="Documents">
                    {DOC_KINDS.map((k) => (
                      <MenuItem
                        key={k.kind}
                        title={k.what}
                        onSelect={() => {
                          close();
                          drawer.open(parsed, k.kind, { section: "packs", id: p.id });
                        }}
                      >
                        {k.label}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                )}
                {deck && (
                  <>
                    <MenuItem
                      expanded={decks}
                      title="A profile for your Stream Deck, laid out from this pack"
                      onSelect={() => setDecks((was) => !was)}
                    >
                      Stream Deck profile
                    </MenuItem>
                    {decks && (
                      <div className="menuSub" role="group" aria-label="Stream Deck profile">
                        {DEVICE_IDS.map((device) => (
                          <MenuItem
                            key={device}
                            onSelect={() => {
                              close();
                              void downloadProfile(deck, device);
                            }}
                          >
                            {DEVICES[device].label}
                          </MenuItem>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {onTest && (
                  <MenuItem
                    title={`Play ${p.title} in ${an(runOne)} that is not saved`}
                    onSelect={() => {
                      close();
                      onTest(p);
                    }}
                  >
                    Test
                  </MenuItem>
                )}
                {record && !record.sealed && onReplace && (
                  <MenuItem
                    title={`Load a newer file of ${p.title}; its ${runMany} are kept`}
                    onSelect={() => {
                      close();
                      file.current?.click();
                    }}
                  >
                    Replace from a file
                  </MenuItem>
                )}
                {record && (
                  <>
                    <MenuRule />
                    <MenuItem
                      tone="danger"
                      title={`Forget ${p.title} and its ${runMany}`}
                      onSelect={() => {
                        close();
                        onForgetPack(record);
                      }}
                    >
                      Forget pack
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
          {/* The picker that line presses. It lives out here so that closing
              the menu does not take the input with it. */}
          {record && !record.sealed && onReplace && (
            <input
              ref={file}
              type="file"
              accept=".yaml,.yml,.json"
              hidden
              aria-hidden="true"
              onChange={(e) => {
                onReplace(record, e.target.files?.[0]);
                // So the same file, fixed and chosen again, counts as a change.
                e.target.value = "";
              }}
            />
          )}
        </div>
      </div>

      {mine.length > 0 && (
        <div className="runList">
          {shown.map((r) => (
            <RunRow
              key={r.runId}
              run={r}
              vocabulary={v}
              open={r.runId === openRunId && inPlay}
              {...(scores?.get(r.runId) ? { score: scores.get(r.runId)! } : {})}
              onPick={() => onContinue(p, r)}
              onForget={() => onForgetRun(r)}
            />
          ))}
          {!everyRun && mine.length > shown.length && (
            <Button size="compact" className="runListAll" onClick={() => setEveryRun(true)}>
              All {runMany}
            </Button>
          )}
        </div>
      )}

      {record &&
        syncAvailable &&
        (record.sealed ? (
          <p className="packSync muted">license key kept in your account; the text stays on this device</p>
        ) : (
          <label className="packSync" title="Its text is stored in your account and comes to your other devices">
            <input type="checkbox" checked={record.sync === true} onChange={(e) => onSyncToggle(record, e.target.checked)} />
            <span>keep this pack in sync</span>
          </label>
        ))}
    </section>
  );
}
