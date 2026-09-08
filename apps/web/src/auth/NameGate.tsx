import { useEffect, useRef, useState } from "react";
import { useAccount } from "./Account.tsx";
import { useApi } from "../sync/useApi.ts";
import { rememberProfile, useProfile } from "../sync/useProfile.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";

/** The server's rule for a shown name, so the answer is known before the round trip. */
export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,23}$/u;

/**
 * Once, for everyone signed in: the name other people see.
 *
 * A table, a race, a reaction and a live link all show a name, and until
 * now that name was whatever the sign-in carried, shown without asking.
 * This asks. The name on the account is offered as the answer; the person
 * confirms it or writes another, and from then on the profile remembers
 * that the choice was theirs. It comes after the terms, when there are
 * terms, and stays out of the way when the server cannot be reached.
 */
export function NameGate() {
  const account = useAccount();
  const api = useApi();
  const hosted = useHosted();
  const { profile, loaded } = useProfile();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const asking =
    account.status === "signed-in" &&
    api !== null &&
    loaded &&
    profile !== null &&
    !profile.handleSetAt &&
    (!hosted?.termsVersion || profile.termsVersion === hosted.termsVersion);

  useEffect(() => {
    if (asking) field.current?.focus();
  }, [asking]);

  if (!asking || account.status !== "signed-in" || !api || !profile) return null;

  const onAccount = [account.user.firstName, account.user.lastName].filter(Boolean).join(" ");
  const value = draft ?? (profile.handle?.trim() || profile.name?.trim() || onAccount);
  const ok = NAME_RULE.test(value.trim());

  const keep = () => {
    const handle = value.trim();
    if (!ok || busy) return;
    setBusy(true);
    setProblem(null);
    void api
      .putProfile({ handle })
      .then((p) => rememberProfile(p))
      .catch((error: unknown) => setProblem(error instanceof Error && error.message ? error.message : "That name was not kept. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="veil" role="presentation">
      <section className="panel termsGate nameGate" role="dialog" aria-modal="true" aria-labelledby="nameTitle">
        <h2 id="nameTitle">How should people see you?</h2>
        <p>
          The people you play with, race, or who watch a live link see this name. Your email address is never shown to
          anyone. You can change it later on your profile.
        </p>
        <label className="inviteForm">
          <span className="muted small">Shown as</span>
          <input
            ref={field}
            className="textInput"
            value={value}
            maxLength={24}
            aria-label="The name others see"
            aria-invalid={!ok || undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && keep()}
          />
        </label>
        <p className="muted small">{problem ?? "Two to twenty-four letters, digits, spaces, dots, dashes or underscores."}</p>
        <div className="padRow">
          <button className="primary" onClick={keep} disabled={!ok || busy}>
            {busy ? "Saving…" : "Use this name"}
          </button>
        </div>
      </section>
    </div>
  );
}
