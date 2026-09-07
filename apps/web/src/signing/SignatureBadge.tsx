import { useEffect, useState } from "react";
import { verifyPack, type VerifyResult } from "@runlog/rules-schema";
import { rememberKey, type KnownKey } from "../storage/db.ts";
import { authorOf, type Claim } from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";

/**
 * What a pack's signature amounts to, said carefully.
 *
 * The temptation here is a green tick reading "Official". That would be a lie:
 * the public key travels inside the pack, so anyone can generate one, sign
 * their own file and put any name on it. A valid signature proves the contents
 * have not changed since *someone* signed them, and nothing more.
 *
 * So this shows three things instead of a verdict. What the signer calls
 * themselves — labeled as a claim. The fingerprint, which is the thing an
 * author publishes and a reader can compare. And whether this browser has seen
 * the key before, which is the only part that gets stronger on its own: a key
 * you have met on four packs since March is a different proposition from one
 * that appeared today wearing a familiar name.
 *
 * And, where there is an API to ask, a fourth: whether an account has
 * claimed the key by proving it holds the private half. That is the one
 * thing that turns "calls themselves" into "is": a claimed key names an
 * account, and the account is who WorkOS says it is.
 */
export function SignatureBadge({ document, packId }: { document: unknown; packId: string }) {
  const issue = (document as { issue?: { to?: string } } | null)?.issue;
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [known, setKnown] = useState<KnownKey | null>(null);
  const [claim, setClaim] = useState<Claim | null | undefined>(undefined);
  const [first, setFirst] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setResult(null);
    setKnown(null);
    void (async () => {
      const verified = await verifyPack(document);
      if (!live) return;
      setResult(verified);
      if (verified.status !== "valid") return;

      // Only a key that actually checked out is worth remembering. Recording
      // one from a pack whose signature failed would teach the browser to
      // vouch for a forgery.
      const before = await rememberKey({
        publicKey: verified.publicKey,
        fingerprint: verified.fingerprint,
        packId,
        ...(verified.signedBy ? { name: verified.signedBy } : {}),
      });
      if (!live) return;
      setKnown(before);
      setFirst(before.packs.length === 1 && before.firstSeen === before.lastSeen);
      const base = apiBase();
      if (base) {
        const who = await authorOf(base, verified.fingerprint).catch(() => null);
        if (live) setClaim(who);
      } else {
        setClaim(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [document, packId]);

  if (!result || result.status === "unsigned") {
    // A copy can be watermarked without being signed. Worth saying either way:
    // the buyer was told their name is in it, and hiding it here would make
    // that a thing done to them rather than told to them.
    if (!issue?.to) return null;
    return (
      <div className="signature">
        <span className="muted small">Your copy, issued to {issue.to}.</span>
      </div>
    );
  }

  if (result.status === "unverifiable") {
    return (
      <div className="signature">
        <span className="muted small">
          This pack is signed, but {result.reason}. Nothing is wrong with it — the check
          simply cannot run here.
        </span>
      </div>
    );
  }

  if (result.status === "invalid") {
    return (
      <div className="signature bad">
        <strong>This pack has been changed since it was signed.</strong>
        <span className="muted small">
          It will still play — nothing here stops you — but it is not what its author
          released, so do not judge their game by it.
        </span>
      </div>
    );
  }

  const names = known?.names ?? [];
  const alias = names.length > 1;

  return (
    <div className="signature">
      <button className="disclose" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾" : "▸"} Signed{claim?.publisher ? ` by ${claim.publisher.name}` : claim?.name ? ` by ${claim.name}` : result.signedBy ? ` — “${result.signedBy}”` : ""}
      </button>{" "}
      <span className="muted small">
        {claim ? "a claimed key" : first ? "a key you have not seen before" : `seen on ${known?.packs.length ?? 1} pack(s)`}
        {issue?.to && ` · your copy, issued to ${issue.to}`}
      </span>

      {open && (
        <div className="signatureDetail">
          <p className="muted small">
            The contents have not changed since they were signed. That is all a signature
            proves — the key travels inside the pack, so the name above is what the signer
            <em> claims</em> to be called, not proof of who they are.
          </p>
          <p className="fingerprint">{result.fingerprint}</p>
          {claim && (
            <p className="muted small">
              This key is claimed by the account {claim.name ? `“${claim.name}”` : "of its owner"}: they proved they hold it, and the
              name above is that account's, not the file's.
            </p>
          )}
          {claim === null && apiBase() && (
            <p className="muted small">No account has claimed this key. The name, if any, is the file's own word.</p>
          )}
          <p className="muted small">
            Compare that against the fingerprint the author publishes. If it matches, this
            really is their release.
          </p>
          {alias && (
            <p className="warnText">
              This key has also signed as {names.filter((n) => n !== result.signedBy).join(", ")}.
            </p>
          )}
          {!first && known && (
            <p className="muted small">
              First seen {known.firstSeen.slice(0, 10)}, across {known.packs.length}{" "}
              {known.packs.length === 1 ? "pack" : "packs"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
