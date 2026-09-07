import { useEffect, useState } from "react";
import YAML from "yaml";
import { fingerprint, generateKeyPair, generateLicenseKey, seal, signBytes, signPack, type Pack } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "../sync/useApi.ts";
import type { Claim } from "../sync/client.ts";
import { packFilename, type Draft } from "./draft.ts";
import { bundle, bundleFilename } from "./bundle.ts";
import { docToPdf } from "../docs/pdfEngine.ts";

/**
 * Sign, and seal, from the Designer.
 *
 * The same three steps the command line has, without the command line: a
 * signing key (made here and downloaded, or a keygen file dropped in; it
 * lives in this page's memory and nowhere else), a claim that puts the
 * account's name behind it, then a signed release or a sealed copy for a
 * buyer. Signing is arithmetic the browser can do; what the account adds
 * is the name, and the panel follows the same rule as the command line:
 * no name on a key nobody has claimed.
 *
 * Nothing here is behind a paid tier. Signing is the trust system and every
 * author should use it; sealing a copy yourself is the free, self-hosted
 * path. The hosted ledger — who bought what, re-issue, revoke — is the paid
 * one and lives on the publisher page when it exists.
 *
 * Either file can go out as a distribution bundle: a zip with the pack and
 * every document as PDF, HTML and Markdown, for a shop listing or a
 * buyer's mailbox. The license key never rides in the bundle.
 */
interface HeldKey {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

function download(name: string, text: string | Uint8Array, type: string) {
  const blob = new Blob([text as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SignPanel({ draft, pack, loads }: { draft: Draft; pack: Pack | null; loads: boolean }) {
  const account = useAccount();
  const api = useApi();
  const [held, setHeld] = useState<HeldKey | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [signedAs, setSignedAs] = useState("");
  const [buyer, setBuyer] = useState("");
  const [ref, setRef] = useState("");
  const [issued, setIssued] = useState<{ file: string; key: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withDocs, setWithDocs] = useState(false);

  const refresh = () => {
    if (api) void api.listClaims().then(setClaims, () => {});
  };
  useEffect(refresh, [api]);

  const claimed = held ? claims.some((c) => c.fingerprint === held.fingerprint) : false;
  const claimName = held ? (claims.find((c) => c.fingerprint === held.fingerprint)?.name ?? null) : null;

  const takeKeyFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Partial<HeldKey>;
      if (!raw.publicKey || !raw.privateKey) throw new Error("not a signing key");
      setHeld({ publicKey: raw.publicKey, privateKey: raw.privateKey, fingerprint: await fingerprint(raw.publicKey) });
      setNote(null);
    } catch {
      setNote("That file is not a Runlog signing key. keygen makes one, and so does the button here.");
    }
  };

  const makeKey = async () => {
    const pair = await generateKeyPair();
    const fp = await fingerprint(pair.publicKey);
    const key = { algorithm: "ecdsa-p256-sha256", publicKey: pair.publicKey, privateKey: pair.privateKey, fingerprint: fp, createdAt: new Date().toISOString() };
    download("runlog-key.json", `${JSON.stringify(key, null, 2)}\n`, "application/json");
    setHeld({ publicKey: pair.publicKey, privateKey: pair.privateKey, fingerprint: fp });
    setNote("Keep runlog-key.json private and backed up. Anyone who has it can sign as you; lose it and you cannot sign again.");
  };

  const claim = async () => {
    if (!api || !held) return;
    setBusy(true);
    setNote(null);
    try {
      const { nonce } = await api.claimNonce();
      const signature = await signBytes(new TextEncoder().encode(nonce), held.privateKey);
      await api.claim(held.publicKey, nonce, signature);
      refresh();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "The claim did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const signRelease = async () => {
    if (!held) return;
    const { signature: _old, issue: _issue, ...clean } = draft;
    const signed = { ...clean, signature: await signPack(clean, held.privateKey, signedAs.trim() || claimName || undefined) };
    const file = packFilename(draft);
    const text = YAML.stringify(signed, { lineWidth: 90 });
    if (withDocs && pack) {
      setBusy(true);
      try {
        download(bundleFilename(file), await bundle({ pack, file: { name: file, data: text }, pdf: docToPdf }), "application/zip");
      } finally {
        setBusy(false);
      }
    } else download(file, text, "text/yaml;charset=utf-8");
  };

  const issueCopy = async () => {
    if (!held || !buyer.trim()) return;
    setBusy(true);
    try {
      const { signature: _old, issue: _issue, ...clean } = draft;
      const stamped = { ...clean, issue: { to: buyer.trim(), ...(ref.trim() ? { reference: ref.trim() } : {}), issuedAt: new Date().toISOString() } };
      const signed = { ...stamped, signature: await signPack(stamped, held.privateKey, signedAs.trim() || claimName || undefined) };
      const licenseKey = generateLicenseKey();
      const bytes = await seal(signed, licenseKey, { ...(ref.trim() ? { ref: ref.trim() } : {}), title: String(draft["title"] ?? "") });
      const file = `${packFilename(draft).replace(/\.(yaml|json)$/, "")}-${buyer.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.rlpack`;
      if (withDocs && pack) {
        const to = buyer.trim();
        download(bundleFilename(file), await bundle({ pack, file: { name: file, data: bytes }, sealed: { to, ...(ref.trim() ? { reference: ref.trim() } : {}) }, pdf: docToPdf }), "application/zip");
        setIssued({ file: bundleFilename(file), key: licenseKey });
      } else {
        download(file, bytes, "application/octet-stream");
        setIssued({ file, key: licenseKey });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel signPanel">
      <h3 className="sectionTitle">
        Sign and seal <span className="muted">a release, or a copy for a buyer</span>
      </h3>

      {account.status !== "signed-in" || !api ? (
        <p className="muted small">
          Sign in to sign. A signature carries your account's name only once you have claimed the key, and claiming needs an account.
          {account.status === "anonymous" && (
            <>
              {" "}
              <button className="ghost tiny" onClick={account.signIn}>
                Sign in
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <h4 className="stepLabel">1. A signing key</h4>
          {held ? (
            <p className="small">
              Holding <span className="mono">{held.fingerprint}</span>
              {claimed ? (
                <span className="chip ok"> claimed{claimName ? ` as ${claimName}` : ""}</span>
              ) : (
                <span className="chip warn"> not yet claimed</span>
              )}
              <button className="ghost tiny" onClick={() => setHeld(null)}>
                Forget it here
              </button>
            </p>
          ) : (
            <div className="padRow">
              <label className="ghost fileButton">
                Use a key file
                <input type="file" accept=".json" onChange={(e) => void takeKeyFile(e.target.files?.[0])} />
              </label>
              <button className="ghost" onClick={() => void makeKey()}>
                Make one here
              </button>
            </div>
          )}
          <p className="muted small">The key stays in this page while it is open and is never sent anywhere. Only its public half is ever shared.</p>

          <h4 className="stepLabel">2. Claim it</h4>
          {held && !claimed && (
            <button className="primary" disabled={busy} onClick={() => void claim()}>
              {busy ? "Claiming…" : "Claim this key as mine"}
            </button>
          )}
          {held && claimed && <p className="muted small">Done. Packs signed with this key show your name in the app.</p>}
          {!held && <p className="muted small">Needs a key first.</p>}

          <h4 className="stepLabel">3. Sign a release</h4>
          <label className="toggle designToggle">
            <input type="checkbox" checked={withDocs} onChange={(e) => setWithDocs(e.target.checked)} disabled={!pack} />
            <span>
              Bundle the documents: a <code>.zip</code> with the file, every document as PDF, HTML and Markdown, and a note on what is what. For a shop listing or a buyer's mailbox.
            </span>
          </label>
          <div className="inviteForm">
            <input className="textInput" placeholder={claimName ? `signed as ${claimName}` : "signed as (your name on the pack)"} value={signedAs} onChange={(e) => setSignedAs(e.target.value)} aria-label="Name to sign as" />
            <button className="primary" disabled={!held || !claimed || !loads || busy} onClick={() => void signRelease()} title={!loads ? "The pack has errors; fix them first" : undefined}>
              {busy && withDocs ? "Bundling…" : withDocs ? "Sign and bundle" : "Sign and download"}
            </button>
          </div>

          <h4 className="stepLabel">4. Or seal a copy for a buyer</h4>
          <div className="inviteForm">
            <input className="textInput" placeholder="buyer's name" value={buyer} onChange={(e) => setBuyer(e.target.value)} aria-label="Buyer's name" />
            <input className="textInput short" placeholder="your order ref" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Order reference" />
            <button className="primary" disabled={!held || !claimed || !loads || !buyer.trim() || busy} onClick={() => void issueCopy()}>
              {busy ? "Sealing…" : withDocs ? "Seal and bundle" : "Seal and download"}
            </button>
          </div>
          {issued && (
            <div className="freshKey">
              <p className="small">
                <strong>{issued.file}</strong> is downloading. Send it with this license key, which is not in the file and is not shown again.
              </p>
              <div className="licenseKey mono">{issued.key}</div>
              <button className="ghost tiny" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>
          )}
          <p className="muted small">
            The copy is stamped with the buyer's name inside the signature and sealed behind the key, the same as{" "}
            <code>runlog issue --seal</code>. Keeping a ledger of who bought what is the hosted publisher tier, later.
          </p>
        </>
      )}
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
