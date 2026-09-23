import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Account } from "../auth/Account.tsx";
import type { Api } from "../sync/client.ts";
import type { Plan } from "../sync/usePlan.ts";
import {
  clearProfileReturn,
  parseProfileReturn,
  profileReturnStorage,
  PROFILE_RETURN_PARAMS,
  takeProfileReturn,
  type BillingProduct,
  type ProfileReturnCallback,
  type ProfileReturnDestination,
  type ProfileReturnIntent,
} from "./returns.ts";

type Callback = Exclude<ProfileReturnCallback, null>;
/** A callback read off the address once, with the token that marks it as not yet used. */
type Pending = { callback: Callback; token: object };
type Owner = { ownerId: string; api: Api; generation: number; token: object };
type Notice = { ownerId: string; api: Api; message: string };

const PRODUCT_NAMES: Record<BillingProduct, string> = {
  plus: "Plus",
  "hosted-licensing": "hosted licensing",
  server: "Runlog for servers",
};

function readCallback(): Pending | null {
  try {
    const callback = parseProfileReturn(location.search);
    return callback ? { callback, token: {} } : null;
  } catch {
    return null;
  }
}

/** Takes the callback's words off the address, leaving everything else as it was. */
function cleanAddress(): void {
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const name of PROFILE_RETURN_PARAMS) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* nothing to clean */
  }
}

export interface ProfileReturnOptions {
  account: Account;
  api: Api | null;
  plan: Plan;
  openProfile: (page: ProfileReturnDestination, how: "replace") => void;
}

/**
 * Back from Stripe's Checkout, Portal or Connect onboarding.
 *
 * The callback is read off the address on the first render and the
 * address is cleaned straight after, so Back and Forward never replay it.
 * It waits while the account is still being checked, and then acts only
 * for the account that stored the matching intent: it reads again what
 * Stripe says, opens the profile page that started it, and says what
 * happened. Whatever it was waiting on is dropped the moment the account
 * or the API changes.
 */
export function useProfileReturn({ account, api, plan, openProfile }: ProfileReturnOptions): {
  message: string | null;
  dismiss: () => void;
} {
  const pending = useRef<Pending | null | undefined>(undefined);
  if (pending.current === undefined) pending.current = readCallback();

  const ownerId = account.status === "signed-in" ? account.user.id : null;
  const identity = useRef({ ownerId, api, generation: 0 });
  const active = useRef<object | null>(null);
  const mounted = useRef(false);
  const planRef = useRef(plan);
  const openRef = useRef(openProfile);
  const [notice, setNotice] = useState<Notice | null>(null);

  useLayoutEffect(() => {
    planRef.current = plan;
    openRef.current = openProfile;
  });

  useLayoutEffect(() => {
    if (identity.current.ownerId !== ownerId || identity.current.api !== api) {
      identity.current = { ownerId, api, generation: identity.current.generation + 1 };
      active.current = null;
    }
  }, [ownerId, api]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The callback is already held in memory; the address need not keep it.
  useEffect(() => {
    if (pending.current) cleanAddress();
  }, []);

  useEffect(() => {
    const held = pending.current;
    if (!held || account.status === "checking") return;
    pending.current = null;
    const storage = profileReturnStorage();
    if (account.status !== "signed-in" || api === null) {
      if (storage) clearProfileReturn(storage);
      return;
    }
    if (!storage) return;
    const intent = takeProfileReturn(storage, account.user.id, held.callback);
    if (!intent) {
      clearProfileReturn(storage);
      return;
    }
    const owner: Owner = { ownerId: account.user.id, api, generation: identity.current.generation, token: held.token };
    active.current = held.token;
    const current = () =>
      mounted.current &&
      identity.current.ownerId === owner.ownerId &&
      identity.current.api === owner.api &&
      identity.current.generation === owner.generation &&
      active.current === owner.token;
    void settle(intent, held.callback, owner, current);
    // The consumption is keyed to who is signed in, not to every new
    // account object: `pending` makes it happen at most once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.status, ownerId, api]);

  const settle = async (intent: ProfileReturnIntent, callback: Callback, owner: Owner, current: () => boolean) => {
    let message: string | null = null;
    try {
      if (callback.kind === "publisher") {
        const publisher = await owner.api.refreshPublisherConnect();
        if (!current()) return;
        message =
          callback.outcome === "connect-again"
            ? "That link had expired. Set up payouts again to continue where you left off."
            : publisher?.connectReady
              ? "Payouts are set up. You can list packs for sale."
              : "Stripe is still checking a few things; press Refresh in a moment.";
      } else if (callback.kind === "billing" && callback.outcome === "done" && intent.kind === "checkout") {
        await owner.api.refreshEntitlements();
        if (!current()) return;
        await planRef.current.refresh();
        if (!current()) return;
        message = `The payment for ${PRODUCT_NAMES[intent.product]} went through. It can take a moment to show here.`;
      } else if (callback.kind === "billing" && callback.outcome === "managed") {
        await planRef.current.refresh();
        if (!current()) return;
      } else if (callback.kind === "billing" && callback.outcome === "canceled") {
        message = "Nothing was charged.";
      }
    } catch {
      if (!current()) return;
      message =
        intent.kind === "checkout"
          ? `The payment for ${PRODUCT_NAMES[intent.product]} went through, but it could not be read just now. Try Refresh in a moment.`
          : intent.kind === "publisher-connect"
            ? "Payouts could not be checked just now. Try Refresh in a moment."
            : "Billing could not be read just now. Try Refresh in a moment.";
    }
    if (!current()) return;
    active.current = null;
    openRef.current(intent.destination, "replace");
    setNotice(message === null ? null : { ownerId: owner.ownerId, api: owner.api, message });
  };

  const dismiss = useCallback(() => setNotice(null), []);
  // Shown only to the account it was said to: a change of account hides
  // it in the very first render for the new one.
  const message = notice && notice.ownerId === ownerId && notice.api === api ? notice.message : null;
  return { message, dismiss };
}
