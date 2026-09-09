import { useEffect, useRef, useState } from "react";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "../sync/useApi.ts";
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
  const [state, setState] = useState<"unknown" | "accepted" | "asking" | "saving">("unknown");
  const accept = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!api || !version) return;
    let live = true;
    setState("unknown");
    void api
      .me()
      .then((me) => live && setState(me.profile.termsVersion === version ? "accepted" : "asking"))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, version]);

  useEffect(() => {
    if (state === "asking") accept.current?.focus();
  }, [state]);

  if (!hosted || !api || account.status !== "signed-in" || state === "unknown" || state === "accepted") return null;

  const agree = () => {
    setState("saving");
    void api
      .putProfile({ termsVersion: hosted.termsVersion })
      .then(() => setState("accepted"))
      .catch(() => setState("asking"));
  };

  return (
    <div className="veil" role="presentation">
      <section className="panel termsGate" role="dialog" aria-modal="true" aria-labelledby="termsTitle">
        <h2 id="termsTitle">Before you go on</h2>
        <p>
          {hosted.legalName ?? hosted.operator} runs this copy of Runlog. Signing in means your runs, packs and the addresses you invite are
          kept on its servers, under its <a href={hosted.links.terms}>terms of service</a> and{" "}
          <a href={hosted.links.privacy}>privacy policy</a>. Please read them; the short version at the top of each is
          the whole idea.
        </p>
        <p className="muted small">Version {hosted.termsVersion}. You are asked again only when they change.</p>
        <div className="padRow">
          <button ref={accept} className="primary" onClick={agree} disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "I accept"}
          </button>
          <button className="ghost" onClick={() => account.signOut()}>
            Sign out instead
          </button>
        </div>
      </section>
    </div>
  );
}
