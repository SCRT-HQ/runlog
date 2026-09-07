/**
 * A live link: `#run/<id>?t=<token>`. The token is the whole key; the
 * app keeps neither it nor the run beyond the page it is shown on.
 */
export interface LiveRoute {
  id: string;
  token: string;
}

export function liveFromHash(hash: string): LiveRoute | null {
  const m = /^#run\/([A-Za-z0-9_-]+)\?(.*)$/.exec(hash);
  if (!m) return null;
  const token = new URLSearchParams(m[2]).get("t") ?? "";
  return token ? { id: m[1]!, token } : null;
}

/** The local key under which the owner's device remembers a run's live link. */
export const liveLinkKey = (runId: string) => `runlog:live:${runId}`;

export function rememberLiveLink(runId: string, link: string | null): void {
  try {
    if (link) localStorage.setItem(liveLinkKey(runId), link);
    else localStorage.removeItem(liveLinkKey(runId));
  } catch {
    /* a browser with no storage keeps it for the page */
  }
}

export function liveLinkOf(runId: string): string | null {
  try {
    return localStorage.getItem(liveLinkKey(runId));
  } catch {
    return null;
  }
}
