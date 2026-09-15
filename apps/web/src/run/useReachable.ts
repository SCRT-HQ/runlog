import { useEffect, useRef, useState } from "react";
import type { Api } from "../sync/client.ts";
import type { StoredRun } from "../storage/db.ts";
import { liveLinkOf, rememberLiveLink } from "../live/route.ts";
import { rememberWatchKey, watchKeyHere } from "./watchKey.ts";

/**
 * A run makes itself reachable, so an address copied from it works.
 *
 * Every stream address a run hands out (a widget in a scene, the socket a
 * tool dials, the live page) needs two things the server issues: the run
 * open to watchers, and a watch key on the account. Both used to be asked
 * for by hand, in two different panels, and neither said much about the
 * other. So the ordinary way to arrive here was to copy an address that
 * could not work and find out from whatever you pasted it into, which in
 * the case of a tool reaching into a game is a dialog saying it could not
 * reach the server.
 *
 * So a hosted run the account owns opens itself, once, and mints a watch
 * key if the account has none.
 *
 * Two rules this must not break:
 *
 * - **Nothing is rotated.** A watch key is minted only where there is
 *   none: minting again replaces the one in every browser source and
 *   attached tool. Sharing again leaves the link alone, which the server
 *   now enforces, but this does not ask twice anyway.
 * - **A run must already exist on the server.** Sharing names a session,
 *   and a run is a local thing until sync creates it. `role` is the server
 *   saying it knows this run, so that is what this waits for.
 *
 * Where plans gate a live link, the share is refused and nothing here says
 * so: the panels already carry that conversation, with the button and the
 * prompt. This is the quiet path for the accounts that have it.
 *
 * It answers with what it has, because doing this quietly and telling
 * nobody was most of the trouble. The link was written to the device and
 * the panel that draws it had already drawn: it appeared on the next
 * reload and not before. And the key it minted was thrown away, which
 * was worse -- the account then had a watch key whose value nothing
 * knew, so the panel would not mint one (the server says there is one)
 * and could not finish the address (this device does not have it). The
 * only way out was the button that makes a new one, which puts out the
 * key in every scene and every attached tool.
 */
export interface Reachable {
  /** The live link, once the run has one. */
  link: string | null;
  /** The account's watch key, as this device knows it. */
  key: string | null;
  /** Still asking the server, so an address is not unfinished, it is unfinished *yet*. */
  working: boolean;
}

export function useReachable(api: Api | null, record: StoredRun | null): Reachable {
  /** Runs this tab has already done this for, so a re-render does not ask twice. */
  const done = useRef<Set<string>>(new Set());
  const [link, setLink] = useState<string | null>(() => (record ? liveLinkOf(record.runId) : null));
  const [key, setKey] = useState<string | null>(() => watchKeyHere());
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!record) return;
    // A different run, or one opened again: say what is known of it now
    // rather than what was known of the last one.
    setLink(liveLinkOf(record.runId));
  }, [record?.runId]);

  useEffect(() => {
    if (!api || !record) return;
    // Not ours to open, or the server has not heard of it yet.
    if (record.role !== "owner") return;
    const runId = record.runId;
    if (done.current.has(runId)) return;
    done.current.add(runId);

    void (async () => {
      setWorking(true);
      try {
        if (record.shared !== true && !liveLinkOf(runId)) {
          const { link: made } = await api.shareRun(runId);
          if (made) {
            rememberLiveLink(runId, made);
            setLink(made);
          }
        }
      } catch {
        // Refused, gated, or offline. The panels say what to do about it.
      }
      try {
        const keys = await api.streamKeys();
        // Only where there is none. A second mint puts the first one out,
        // wherever it is in use, and nobody asked for that.
        if (!keys.watch) {
          const made = await api.mintStreamKey("watch");
          // Remembered, which is the whole point of minting it. Without
          // this the account has a key nothing can name.
          rememberWatchKey(made.key);
          setKey(made.key);
        }
      } catch {
        // As above: the panel still offers to make one.
      } finally {
        setWorking(false);
      }
    })();
  }, [api, record]);

  return { link, key, working };
}
