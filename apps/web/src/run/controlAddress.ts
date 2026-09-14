import { apiBase } from "../sync/config.ts";

/** Said where the key is not in hand yet, so the line is obviously unfinished. */
export const NO_KEY = "REPLACE-WITH-YOUR-WATCH-KEY";

/**
 * The address a tool dials to reach one run.
 *
 * One per person where there is a roster. A connection that says which
 * seat it is hears the rules addressed to that seat as well as the ones
 * addressed to nobody, so a race is set up by handing each runner their
 * own line of this and nothing else: one curse can land on one of them
 * and the warp can still land on all of them.
 *
 * It names the run. A watch key on its own reaches whichever run of
 * yours moved most recently and is open to watchers, which is right for
 * a browser source that sits in a scene for months and wrong for a tool
 * reaching into a game: a run that ends, or a newer one somewhere else,
 * silently moves the tool to a run whose pack has nothing to say to it.
 * With `run=` the address either finds this run or is refused, and being
 * refused is the better of the two.
 *
 * Lives here rather than in the settings panel because the table needs
 * it too: a person setting a tool up is looking at the list of who is
 * playing, not at a dialog behind it.
 */
export function controlAddress({
  key,
  runId,
  seat,
}: {
  key: string | null;
  runId?: string | undefined;
  seat?: string | undefined;
}): string {
  const b = (apiBase() ?? "/api").replace(/\/$/, "");
  const origin = /^https?:/.test(b) ? new URL(b).origin : typeof location !== "undefined" ? location.origin : "";
  const k = key ? encodeURIComponent(key) : NO_KEY;
  const run = runId ? `&run=${encodeURIComponent(runId)}` : "";
  const tail = seat ? `&seat=${encodeURIComponent(seat)}` : "";
  return `${origin.replace(/^http/, "ws")}/ws?k=${k}${run}&as=control${tail}`;
}
