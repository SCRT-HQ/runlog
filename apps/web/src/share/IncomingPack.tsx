import { useEffect, useState } from "react";
import { parsePack, verifyPack, type VerifyResult } from "@runlog/rules-schema";
import { decodePack, LINK_PREFIX } from "./link.ts";

/**
 * A pack that arrived in a link.
 *
 * Deliberately not opened on arrival. A link replaces what you are looking at,
 * and a link can come from anyone — so this says what it holds, who if anyone
 * signed it, and whether it loads, and then waits to be told. Packs are data
 * and cannot execute anything, so the risk is not danger; it is being dropped
 * into a stranger's game with no idea what happened.
 *
 * The fragment is cleared once handled, so a reload does not re-open a pack
 * the reader has already dismissed.
 */

export interface Incoming {
  document: unknown;
  title: string;
  author?: string;
  loads: boolean;
  problem?: string;
  signature: VerifyResult;
}

/** Read whatever is in the address bar, once, on load. */
export function useIncomingPack(): {
  incoming: Incoming | null;
  error: string | null;
  clear: () => void;
} {
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const read = async (hash: string) => {
      if (!hash.startsWith(LINK_PREFIX)) return;
      const result = await decodePack(hash);
      if (!live) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const parsed = parsePack(result.document);
      const named = result.document as { title?: unknown; author?: unknown };
      setIncoming({
        document: result.document,
        title: typeof named.title === "string" ? named.title : "an untitled pack",
        ...(typeof named.author === "string" && named.author ? { author: named.author } : {}),
        loads: parsed.ok,
        ...(parsed.ok
          ? {}
          : { problem: parsed.diagnostics.find((d) => d.level === "error")?.message }),
        signature: await verifyPack(result.document),
      });
    };

    void read(location.hash);

    // A link pasted into a tab that already has the app open changes the hash
    // without reloading, so nothing would happen — which looks exactly like a
    // broken link to whoever sent it.
    const onHashChange = () => void read(location.hash);
    addEventListener("hashchange", onHashChange);
    return () => {
      live = false;
      removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const clear = () => {
    setIncoming(null);
    setError(null);
    // Replace rather than push, so Back does not walk into the link again.
    history.replaceState(null, "", location.pathname + location.search);
  };

  return { incoming, error, clear };
}

export function IncomingPackBanner({
  incoming,
  error,
  onOpen,
  onDismiss,
}: {
  incoming: Incoming | null;
  error: string | null;
  onOpen: (document: unknown) => void;
  onDismiss: () => void;
}) {
  if (error) {
    return (
      <div className="incoming bad">
        <span>Someone shared a pack with you, but {error}.</span>
        <button className="ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }
  if (!incoming) return null;

  const { signature } = incoming;

  return (
    <div className={`incoming ${incoming.loads ? "" : "bad"}`}>
      <div className="incomingWhat">
        <strong>{incoming.title}</strong>
        {incoming.author && <span className="muted"> by {incoming.author}</span>}
        <span className="muted small">
          {" "}
          · shared with you in a link
          {signature.status === "valid" &&
            ` · signed${signature.signedBy ? ` — “${signature.signedBy}”` : ""}`}
          {signature.status === "invalid" && " · signature does not match"}
        </span>
        {!incoming.loads && (
          <div className="muted small">
            It does not load: {incoming.problem ?? "it is not a valid pack"}
          </div>
        )}
        {signature.status === "valid" && (
          <div className="muted small">Fingerprint {signature.fingerprint}</div>
        )}
        {signature.status === "invalid" && (
          <div className="muted small">
            It carries a signature that does not match its contents — someone changed it
            after it was signed.
          </div>
        )}
      </div>
      <div className="incomingActions">
        <button className="primary" disabled={!incoming.loads} onClick={() => onOpen(incoming.document)}>
          Open it
        </button>
        <button className="ghost" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
