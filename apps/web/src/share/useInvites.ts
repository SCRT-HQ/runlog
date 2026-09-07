import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, PendingInvite } from "../sync/client.ts";

/**
 * The invitations waiting for this account, kept fresh enough for a badge.
 *
 * Asked once the API exists, again whenever the menu opens or the window
 * comes back into focus, and every couple of minutes in between, which is
 * fast enough for a count in a menu and slow enough to cost nothing. An
 * answer that fails leaves the last one standing; a failing badge is worse
 * than a stale one.
 */
const EVERY_MS = 120_000;

export function useInvites(api: Api | null, open: boolean): { invites: PendingInvite[]; refresh: () => void; forget: (token: string) => void } {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const live = useRef(true);

  const refresh = useCallback(() => {
    if (!api) return;
    void api.myInvites().then(
      (list) => live.current && setInvites(list),
      () => {},
    );
  }, [api]);

  useEffect(() => {
    live.current = true;
    if (!api) {
      setInvites([]);
      return;
    }
    refresh();
    const timer = setInterval(refresh, EVERY_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      live.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [api, refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const forget = useCallback((token: string) => setInvites((list) => list.filter((i) => i.token !== token)), []);

  return { invites, refresh, forget };
}
