import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Disclosure } from "../ui/Disclosure.tsx";

/**
 * Where a panel's reading is heard from outside the column.
 *
 * A phone shows one plane at a time, so the whole column can be the thing
 * nobody is looking at, and a panel that is open cannot mark its own fold:
 * it is open, and on a wide screen that means read. The rail asks the same
 * question one level up, of the plane rather than the panel, and needs the
 * same readings to answer it, so each panel says what it is carrying and
 * whoever is listening decides what that is worth.
 *
 * Nothing listens by default; a column drawn on its own behaves exactly as
 * it did.
 */
const SideNews = createContext<((panel: string, news: string | number | undefined) => void) | null>(null);

/** Hear every reading the panels underneath report, by panel id. */
export function SideNewsListener({
  onNews,
  children,
}: {
  onNews: (panel: string, news: string | number | undefined) => void;
  children: ReactNode;
}) {
  return <SideNews.Provider value={onNews}>{children}</SideNews.Provider>;
}

/**
 * One panel in the run's side column, which folds and is remembered.
 *
 * The column grew past what fits on a screen, and the only two panels that
 * folded were the two that happened to be written as `details`. They are all
 * the same shape now: a title you can press, a triangle that says which way it
 * is, and the body under it.
 *
 * What the fold is worth depends on it lasting. A player who folds the board
 * away on a pack whose board they never read wants it folded the next time
 * too, so the fold is kept on the device, under a key naming this run and this
 * panel. It never reaches the engine, the run's events or another device: it
 * is a fact about a screen, not about a game. A run that has not been saved
 * yet has no id to key on and simply is not remembered.
 *
 * Which way a panel opens to begin with follows what it is worth opening for,
 * which the column already decides by not drawing a panel that has nothing in
 * it: Trackers are only drawn for a pack that keeps some, the Scoreboard only
 * for a moderated run, the race only for a run in one. So every panel opens,
 * and a panel with nothing to say is absent rather than folded shut.
 *
 * A folded panel can still say that something landed behind it. `news` is a
 * reading of what the panel shows, whatever shape it takes: while the panel is
 * open the reading is taken as seen, and while it is folded a reading that
 * differs from the last seen one puts the marker on the fold. Opening it
 * clears the marker, since the thing is now in front of the player.
 */
export function SidePanel({
  runId,
  panel,
  title,
  className,
  defaultOpen = true,
  news,
  children,
}: {
  /** The run this fold belongs to, so one run's arrangement is not another's. Null before a run is saved. */
  runId: string | null;
  /** A stable id for this panel, its own and not its title, which the title may change under it. */
  panel: string;
  /** The heading, which may carry the muted span some titles put after the name. */
  title: ReactNode;
  /** What the panel used to carry on its `section`, kept so its own rules still find it. */
  className?: string;
  defaultOpen?: boolean;
  /** A reading of what is behind the fold. A reading that changes while folded raises the marker. */
  news?: string | number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const seen = useRef(news);
  const [fresh, setFresh] = useState(false);
  const heard = useContext(SideNews);
  useEffect(() => {
    heard?.(panel, news);
  }, [heard, panel, news]);
  useEffect(() => {
    if (open) {
      seen.current = news;
      setFresh(false);
      return;
    }
    if (news !== seen.current) setFresh(true);
  }, [open, news]);
  return (
    <Disclosure
      summary={title}
      className={className}
      defaultOpen={defaultOpen}
      {...(runId ? { remember: `panel:${runId}:${panel}` } : {})}
      onOpenChange={setOpen}
      signal={fresh}
      signalLabel="new"
    >
      {children}
    </Disclosure>
  );
}
