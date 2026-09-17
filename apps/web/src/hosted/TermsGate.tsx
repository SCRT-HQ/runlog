import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "../auth/Account.tsx";
import type { Api } from "../sync/client.ts";
import { useApi } from "../sync/useApi.ts";
import { rememberProfile } from "../sync/useProfile.ts";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { useHosted } from "./HostedProvider.tsx";

/**
 * Once per version of the terms, for people signed in.
 *
 * The hosted file names the terms' version; the profile remembers which
 * one this account accepted. When they differ, this asks: over the app,
 * not instead of it, so what was on screen is still there behind. Nobody
 * anonymous is asked: they have agreed to nothing and hold nothing here.
 * If the server cannot be reached the gate stays out of the way; asking
 * again next time costs nothing, blocking someone offline would.
 */
export function TermsGate() {
  const hosted = useHosted();
  const account = useAccount();
  const api = useApi();
  const version = hosted?.termsVersion;
  const accountId = account.status === "signed-in" ? account.user.id : null;
  const [state, setState] = useState<"unknown" | "accepted" | "asking" | "saving">("unknown");
  const [saveFailure, setSaveFailure] = useState<{ api: Api; accountId: string; version: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  const handleTaken = useRef(false);
  const mounted = useRef(false);
  const requestContext = useRef({
    api,
    accountId,
    version,
  });
  requestContext.current = {
    api,
    accountId,
    version,
  };
  const saveFailed =
    saveFailure !== null && saveFailure.api === api && saveFailure.accountId === accountId && saveFailure.version === version;
  const required = hosted !== null && api !== null && account.status === "signed-in" && (state === "asking" || state === "saving");
  const stayOpen = useCallback(() => {}, []);

  useFocusTrap(panel, required, stayOpen, accept, { required: true });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setState("unknown");
    setSaveFailure(null);
    if (!api || !version || !accountId) return;
    let live = true;
    void api
      .me()
      .then((me) => {
        if (!live) return;
        handleTaken.current = me.handleTaken === true;
        setState(me.profile.termsVersion === version ? "accepted" : "asking");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId, api, version]);

  useEffect(() => {
    if (state === "asking") accept.current?.focus();
  }, [state]);

  if (!hosted || !api || account.status !== "signed-in" || state === "unknown" || state === "accepted") return null;

  const agree = () => {
    const accountId = account.user.id;
    const savingWith = api;
    const savingVersion = hosted.termsVersion;
    const savingHandleTaken = handleTaken.current;
    const stillCurrent = () => {
      const current = requestContext.current;
      return mounted.current && current.api === savingWith && current.accountId === accountId && current.version === savingVersion;
    };
    setSaveFailure(null);
    setState("saving");
    void api
      .putProfile({ termsVersion: savingVersion })
      .then((profile) => {
        if (!stillCurrent()) return;
        rememberProfile(profile, savingHandleTaken);
        setState("accepted");
      })
      .catch(() => {
        if (!stillCurrent()) return;
        setSaveFailure({ api: savingWith, accountId, version: savingVersion });
        setState("asking");
      });
  };

  return createPortal(
    <div className="veil requiredVeil" role="presentation">
      <section ref={panel} className="panel termsGate" role="dialog" aria-modal="true" aria-labelledby="termsTitle" tabIndex={-1}>
        <h2 id="termsTitle">Before you go on</h2>
        <p>
          {hosted.legalName ?? hosted.operator} runs this copy of Runlog. Signing in means your runs, packs and the addresses you invite are
          kept on its servers, under its <a href={hosted.links.terms}>terms of service</a> and{" "}
          <a href={hosted.links.privacy}>privacy policy</a>. Please read them; the short version at the top of each is the whole idea.
        </p>
        <p className="muted small">Version {hosted.termsVersion}. You are asked again only when they change.</p>
        {saveFailed && (
          <p className="notice" role="alert">
            We couldn't save your acceptance. Check your connection and try again.
          </p>
        )}
        <div className="padRow">
          <button
            ref={accept}
            className="primary"
            onClick={agree}
            disabled={state === "saving"}
            aria-busy={state === "saving" || undefined}
          >
            {state === "saving" ? "Saving…" : "I accept"}
          </button>
          <button className="ghost" onClick={() => account.signOut()}>
            Sign out instead
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
