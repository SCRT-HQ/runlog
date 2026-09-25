import { presentationSnapshotKey, type LookChannelSummaryV1 } from "@runlog/themes";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tokenSubject, useAccount } from "../../auth/Account.tsx";
import { createTransport } from "../../sync/client.ts";
import { apiBase } from "../../sync/config.ts";
import { createLookApi, type LookApi } from "../../sync/lookApi.ts";
import { systemPrefersLight } from "../../widget/look.ts";
import { resolvedSnapshot } from "../appearance.ts";
import { useAppearance } from "../useAppearance.ts";
import { openLookChannelStore, type LocalLookChannel, type LookChannelStore } from "./channelStore.ts";
import { createLookPublisher, type LookActionResult, type LookPublisher, type LookPublishState } from "./publisher.ts";

export interface LookChannelView {
  /** Signed in on the hosted build, with this device's record read: a theme link can be made here. */
  readonly available: boolean;
  readonly state: LookPublishState;
  readonly channel: { readonly id: string; readonly readKey: string | null; readonly published: boolean } | null;
  create(): Promise<LookActionResult>;
  takeOver(id: string): Promise<LookActionResult>;
  relink(): Promise<LookActionResult>;
  revoke(id: string): Promise<boolean>;
  list(): Promise<readonly LookChannelSummaryV1[]>;
}

const NONE: LookPublishState = Object.freeze({ kind: "none" });
const refuse = async (): Promise<LookActionResult> => "error";
export const NO_LOOK_CHANNEL: LookChannelView = Object.freeze({
  available: false,
  state: NONE,
  channel: null,
  create: refuse,
  takeOver: refuse,
  relink: refuse,
  revoke: async () => false,
  list: async () => [],
});

/** Exported for tests, which stand a view in without an account. */
export const LookChannelContext = createContext<LookChannelView>(NO_LOOK_CHANNEL);

export function useLookChannel(): LookChannelView {
  return useContext(LookChannelContext);
}

interface Held {
  readonly owner: string;
  readonly publisher: LookPublisher;
  readonly api: LookApi;
}
interface Seen {
  readonly owner: string;
  readonly state: LookPublishState;
  readonly channel: LookChannelView["channel"];
}

const viewOf = (channel: LocalLookChannel | null): LookChannelView["channel"] =>
  channel === null ? null : { id: channel.id, readKey: channel.readKey, published: channel.revision > 0 };

/**
 * This device's theme link, for the signed-in account on the hosted build.
 *
 * It publishes the applied look a second after each Apply, here or in
 * another tab of this browser, and after Restore default; a System choice
 * goes out resolved, and again when the operating system switches between
 * light and dark. It stops the moment the account changes or signs out.
 * The device Sync switch does not stop it: a link is made on purpose.
 */
export function LookChannelProvider({ children }: { children: ReactNode }): ReactNode {
  const account = useAccount();
  const appearance = useAppearance();
  const latest = useRef(appearance);
  latest.current = appearance;
  const base = apiBase();
  const accountId = account.status === "signed-in" ? account.user.id : null;
  const getToken = account.status === "signed-in" ? account.getAccessToken : null;
  const tokenRef = useRef<{ readonly id: string; readonly get: () => Promise<string> } | null>(null);
  useLayoutEffect(() => {
    tokenRef.current = accountId !== null && getToken !== null ? { id: accountId, get: getToken } : null;
  }, [accountId, getToken]);
  const heldRef = useRef<Held | null>(null);
  const [seen, setSeen] = useState<Seen | null>(null);

  useEffect(() => {
    if (accountId === null || base === undefined) return;
    const owner = accountId;
    let cancelled = false;
    let store: LookChannelStore | null = null;
    let publisher: LookPublisher | null = null;
    const api = createLookApi(
      createTransport(base, async () => {
        const bound = tokenRef.current;
        if (cancelled || bound === null || bound.id !== owner) throw new Error("signed out");
        const token = await bound.get();
        // The session is shared across tabs: a token that is not the owner's is a sign-out here.
        if (cancelled || tokenRef.current?.id !== owner || tokenSubject(token) !== owner) throw new Error("signed out");
        return token;
      }),
    );
    void openLookChannelStore({ kind: "account", id: owner })
      .then((opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        store = opened;
        publisher = createLookPublisher({
          api,
          store: opened,
          snapshot: () => resolvedSnapshot(latest.current, systemPrefersLight()),
          onState: (state, channel) => {
            if (!cancelled) setSeen({ owner, state, channel: viewOf(channel) });
          },
        });
        heldRef.current = { owner, publisher, api };
        void publisher.start();
      })
      .catch(() => {
        // A browser that cannot keep the secret cannot publish: the choice stays unavailable here.
      });
    const onOnline = () => publisher?.applied();
    let media: MediaQueryList | null = null;
    try {
      media = globalThis.matchMedia?.("(prefers-color-scheme: light)") ?? null;
    } catch {
      media = null;
    }
    const onScheme = () => {
      if (latest.current.mode === "system") publisher?.applied();
    };
    window.addEventListener("online", onOnline);
    media?.addEventListener?.("change", onScheme);
    return () => {
      cancelled = true;
      publisher?.stop();
      if (heldRef.current?.owner === owner) heldRef.current = null;
      store?.close();
      window.removeEventListener("online", onOnline);
      media?.removeEventListener?.("change", onScheme);
      setSeen(null);
    };
  }, [accountId, base]);

  // Every applied look, whichever tab applied it: one publish a second after the last.
  const appliedKey = appearance.mode === "snapshot" ? presentationSnapshotKey(appearance.snapshot) : "system";
  useEffect(() => {
    heldRef.current?.publisher.applied();
  }, [appliedKey]);

  const value = useMemo<LookChannelView>(() => {
    // Available once this account's publisher has read its record, so an action never meets an empty ref.
    const mine = seen !== null && seen.owner === accountId ? seen : null;
    if (accountId === null || base === undefined || mine === null) return NO_LOOK_CHANNEL;
    const held = () => (heldRef.current?.owner === accountId ? heldRef.current : null);
    return {
      available: true,
      state: mine.state,
      channel: mine.channel,
      create: async () => (await held()?.publisher.create()) ?? "error",
      takeOver: async (id) => (await held()?.publisher.takeOver(id)) ?? "error",
      relink: async () => (await held()?.publisher.relink()) ?? "error",
      revoke: async (id) => (await held()?.publisher.revoke(id)) ?? false,
      list: async () => (await held()?.api.list()) ?? [],
    };
  }, [accountId, base, seen]);

  return <LookChannelContext.Provider value={value}>{children}</LookChannelContext.Provider>;
}
