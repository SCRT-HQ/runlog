import { useEffect, useState } from "react";

/**
 * A race code that arrived in a link.
 *
 * `?race=<code>` is read once, taken off the address bar, and kept in
 * sessionStorage until it is used or dismissed: joining means signing
 * in, which is a round trip, and then opening the right pack. The code
 * is offered in the setup screen's Join field once the pack is open.
 */

const KEY = "runlog:race";

export function pendingRaceCode(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** A code typed on the shelf: kept the way a linked one is, for the setup screen to offer. */
export function rememberRaceCode(code: string): void {
  try {
    sessionStorage.setItem(KEY, code.toUpperCase());
  } catch {
    /* nothing to do */
  }
}

export function clearPendingRaceCode(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

function readCode(): string | null {
  try {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get("race");
    if (fromUrl) {
      url.searchParams.delete("race");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      sessionStorage.setItem(KEY, fromUrl.toUpperCase());
      return fromUrl.toUpperCase();
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useIncomingRace(): { code: string | null; clear: () => void } {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    setCode(readCode());
  }, []);
  return {
    code,
    clear: () => {
      setCode(null);
      clearPendingRaceCode();
    },
  };
}

export function RaceBanner({ code, onDismiss }: { code: string; onDismiss: () => void }) {
  return (
    <div className="incoming">
      <div className="incomingWhat">
        <span>You have a race code: </span>
        <strong className="mono">{code}</strong>
        <div className="muted small">Open the pack the race is for, sign in, and the code is waiting under Race on the setup screen.</div>
      </div>
      <div className="incomingActions">
        <button className="ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
