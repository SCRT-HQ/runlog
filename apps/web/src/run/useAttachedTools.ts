import { useEffect, useState } from "react";
import { syncBus } from "../sync/bus.ts";

/** One tool on one game: the seat it says it is playing, and what it calls itself. */
export interface AttachedTool {
  seat?: string;
  app?: string;
  /**
   * The account the tool's connection is on, as the server names it.
   *
   * A tool dials on a watch key rather than signing in, so this is the
   * key's owner in the server's own form and not a bare account id. It
   * tells a tool on somebody's game from one on the table.
   */
  sub?: string;
}

/**
 * Which games a run is holding the other end of.
 *
 * A run with rules for a tool looks exactly like a run without one until
 * something is drawn, and then it either happens in the game or it does
 * not. That is a bad moment to find out. So the table is told who is
 * attached while nothing is happening, which is the only time it is
 * useful to know.
 *
 * The server sends the whole list every time it changes rather than a
 * joining and a leaving, so this holds what it last heard and never has
 * to keep a tally in step. A run that nobody has attached to sends
 * nothing at all and this stays empty, which is the right answer for the
 * many runs that will never have a tool near them.
 */
export function useAttachedTools(runId: string | null): AttachedTool[] {
  const [tools, setTools] = useState<AttachedTool[]>([]);

  useEffect(() => {
    setTools([]);
    if (!runId) return;
    return syncBus.subscribe((news) => {
      if (news.t !== "gesture" || news.id !== runId || news.kind !== "tools") return;
      const list = (news.data as { tools?: unknown }).tools;
      if (!Array.isArray(list)) return;
      setTools(
        list
          .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
          .map((t) => ({
            ...(typeof t["seat"] === "string" && t["seat"] ? { seat: t["seat"] } : {}),
            ...(typeof t["app"] === "string" && t["app"] ? { app: t["app"] } : {}),
            ...(typeof t["sub"] === "string" && t["sub"] ? { sub: t["sub"] } : {}),
          })),
      );
    });
  }, [runId]);

  return tools;
}

/**
 * How many decks are on this run.
 *
 * The same `tools` gesture that names attached games names decks, so the
 * publisher can switch itself on for one. A count rather than a list:
 * nothing at the table needs to tell two decks apart.
 */
export function useAttachedDecks(runId: string | null): number {
  const [decks, setDecks] = useState(0);
  useEffect(() => {
    setDecks(0);
    if (!runId) return;
    return syncBus.subscribe((news) => {
      if (news.t !== "gesture" || news.id !== runId || news.kind !== "tools") return;
      const n = (news.data as { decks?: unknown }).decks;
      if (typeof n === "number") setDecks(n);
    });
  }, [runId]);
  return decks;
}

/**
 * Which accounts have a deck on this run.
 *
 * The count says a deck is here; this says whose, which is what the
 * people panel needs to put the mark on the right row. An account with
 * two decks appears once. An older server sends no such field and this
 * stays empty, which draws every row unlit rather than wrongly.
 */
export function useAttachedDeckSubs(runId: string | null): string[] {
  const [subs, setSubs] = useState<string[]>([]);
  useEffect(() => {
    setSubs([]);
    if (!runId) return;
    return syncBus.subscribe((news) => {
      if (news.t !== "gesture" || news.id !== runId || news.kind !== "tools") return;
      const list = (news.data as { deckSubs?: unknown }).deckSubs;
      setSubs(Array.isArray(list) ? list.filter((s): s is string => typeof s === "string" && s !== "") : []);
    });
  }, [runId]);
  return subs;
}

/**
 * Whether this named racer has a tool on their game.
 *
 * A tool says which seat it is playing when it attaches, so a race can
 * show it per person. One that says nothing is still attached to
 * something, and on a board with names that is worth showing as a tool
 * without a name rather than not at all.
 */
export function toolFor(tools: AttachedTool[], seat: string): AttachedTool | undefined {
  const wanted = seat.trim().toLowerCase();
  return tools.find((t) => (t.seat ?? "").trim().toLowerCase() === wanted);
}
