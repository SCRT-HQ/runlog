import { useEffect, useRef, useState } from "react";
import type { StoredLicense } from "../storage/db.ts";
import { Button } from "../ui/Button.tsx";

type CopyState = "idle" | "busy" | "copied";
type ForgetState = "idle" | "arming" | "busy" | "done";

/** A stored receipt stays private until somebody explicitly shows or copies it. */
export function LicenseRow({ license, title, onForget }: { license: StoredLicense; title: string; onForget: () => Promise<void> }) {
  const identity = `${license.packId}\0${license.key}`;
  return <LicenseRowContent key={identity} license={license} title={title} onForget={onForget} />;
}

function LicenseRowContent({ license, title, onForget }: { license: StoredLicense; title: string; onForget: () => Promise<void> }) {
  const [shown, setShown] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [forgetState, setForgetState] = useState<ForgetState>("idle");
  const [feedback, setFeedback] = useState("");
  const copyRequest = useRef(0);
  const forgetRequest = useRef(0);
  const copyPending = useRef(false);
  const forgetPending = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      copyRequest.current += 1;
      forgetRequest.current += 1;
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    };
  }, []);

  const ownsLifecycle = () => mounted.current;

  const copy = async () => {
    if (copyPending.current) return;
    copyPending.current = true;
    const attempt = ++copyRequest.current;
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = null;
    setCopyState("busy");
    setFeedback("");
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        copyPending.current = false;
        if (ownsLifecycle() && copyRequest.current === attempt) {
          setCopyState("idle");
          setFeedback("Clipboard is unavailable. Try Copy again when clipboard access is available.");
        }
        return;
      }
      await clipboard.writeText(license.key);
      copyPending.current = false;
      if (!ownsLifecycle() || copyRequest.current !== attempt) return;
      setCopyState("copied");
      setFeedback("License key copied.");
      copiedTimer.current = setTimeout(() => {
        if (ownsLifecycle() && copyRequest.current === attempt) setCopyState("idle");
        copiedTimer.current = null;
      }, 1200);
    } catch {
      copyPending.current = false;
      if (!ownsLifecycle() || copyRequest.current !== attempt) return;
      setCopyState("idle");
      setFeedback("Could not copy the license key. Try Copy again.");
    }
  };

  const forget = async () => {
    if (forgetState !== "arming" || forgetPending.current) return;
    forgetPending.current = true;
    const attempt = ++forgetRequest.current;
    setForgetState("busy");
    setFeedback("");
    try {
      await onForget();
      forgetPending.current = false;
      if (!ownsLifecycle() || forgetRequest.current !== attempt) return;
      setForgetState("done");
      setFeedback("License key forgotten.");
    } catch {
      forgetPending.current = false;
      if (!ownsLifecycle() || forgetRequest.current !== attempt) return;
      setForgetState("idle");
      setFeedback("The license key was not forgotten. Press Forget to try again.");
    }
  };

  const masked = license.key.replace(/[A-Z0-9](?=.{5})/gi, "•");
  return (
    <div className="row licenseRow">
      <div className="licenseMain">
        <strong>{title}</strong>
        {license.ref && <div className="licenseOrder muted">order {license.ref}</div>}
        <div className="licenseKey">{shown ? license.key : masked}</div>
      </div>
      <div className="licenseActions">
        <Button size="compact" onClick={() => setShown((value) => !value)}>
          {shown ? "Hide" : "Show"}
        </Button>
        <Button size="compact" loading={copyState === "busy"} loadingLabel="Copying…" onClick={() => void copy()}>
          {copyState === "copied" ? "Copied" : "Copy"}
        </Button>
        {forgetState === "arming" ? (
          <>
            <Button variant="danger" size="compact" onClick={() => void forget()}>
              Forget it
            </Button>
            <Button size="compact" onClick={() => setForgetState("idle")}>
              Keep
            </Button>
          </>
        ) : forgetState === "busy" ? (
          <Button variant="danger" size="compact" loading loadingLabel="Forgetting…">
            Forget it
          </Button>
        ) : forgetState === "done" ? (
          <Button variant="danger" size="compact" disabled>
            Forgotten
          </Button>
        ) : (
          <Button
            size="compact"
            title="Remove this key from your account and this device"
            onClick={() => {
              setForgetState("arming");
              setFeedback("");
            }}
          >
            Forget
          </Button>
        )}
      </div>
      <span className="licenseStatus muted" role="status">
        {feedback}
      </span>
    </div>
  );
}
