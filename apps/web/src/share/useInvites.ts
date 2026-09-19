import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../auth/Account.tsx";
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

export function useInvites(
  api: Api | null,
  open: boolean,
): { invites: PendingInvite[]; refresh: () => void; forget: (token: string) => void } {
  const account = useAccount();
  const ownerId = account.status === "signed-in" ? account.user.id : null;
  const [snapshot, setSnapshot] = useState<{ ownerId: string; api: Api; invites: PendingInvite[] } | null>(null);
  const current = useRef<{ ownerId: string | null; api: Api | null }>({ ownerId, api });
  const mounted = useRef(true);
  current.current = { ownerId, api };

  const refresh = useCallback(() => {
    if (!api || !ownerId) return;
    const requestedFor = { ownerId, api };
    void api.myInvites().then(
      (list) => {
        if (mounted.current && current.current.ownerId === requestedFor.ownerId && current.current.api === requestedFor.api) {
          setSnapshot({ ...requestedFor, invites: list });
        }
      },
      () => {},
    );
  }, [api, ownerId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!api || !ownerId) return;
    refresh();
    const timer = setInterval(refresh, EVERY_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [api, ownerId, refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const forget = useCallback(
    (token: string) =>
      setSnapshot((before) =>
        before && before.ownerId === ownerId && before.api === api
          ? { ...before, invites: before.invites.filter((invite) => invite.token !== token) }
          : before,
      ),
    [api, ownerId],
  );

  const invites = snapshot && snapshot.ownerId === ownerId && snapshot.api === api ? snapshot.invites : [];
  return { invites, refresh, forget };
}
