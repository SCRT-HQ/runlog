import { useCallback, useEffect, useState } from "react";
import type { Api, ApiKey, Claim, KeyScope } from "../sync/client.ts";

type DeveloperKeysLoad =
  { kind: "unavailable" } | { kind: "loading" } | { kind: "ready"; keys: ApiKey[]; claims: Claim[] } | { kind: "error"; message: string };

/** Account-owned command-line credentials and claimed signing identities. */
export function DeveloperKeysPage({ api }: { api: Api | null }) {
  const [load, setLoad] = useState<DeveloperKeysLoad>(() => (api ? { kind: "loading" } : { kind: "unavailable" }));
  const [request, setRequest] = useState(0);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<KeyScope>("release");
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    if (!api) {
      setLoad({ kind: "unavailable" });
      return;
    }
    let active = true;
    setLoad({ kind: "loading" });
    void Promise.all([api.listKeys(), api.listClaims()]).then(
      ([keys, claims]) => {
        if (active) setLoad({ kind: "ready", keys, claims });
      },
      (error: unknown) => {
        if (!active) return;
        setLoad({
          kind: "error",
          message: error instanceof Error && error.message ? error.message : "That could not be read just now.",
        });
      },
    );
    return () => {
      active = false;
    };
  }, [api, request]);

  return (
    <div className="profile profileApplication">
      <h2>Developer keys</h2>
      <section className="panel">
        <h3 className="sectionTitle">
          Command line <span className="muted">keys for CI, and the signing keys you have claimed</span>
        </h3>
        {!api || load.kind === "unavailable" ? (
          <p className="muted small">Sign in on a hosted address to make a key for the command line.</p>
        ) : load.kind === "loading" ? (
          <p className="muted small">Reading developer keys…</p>
        ) : load.kind === "error" ? (
          <p className="muted small">
            Developer keys could not be loaded.{" "}
            <button className="linkButton" onClick={refresh}>
              Retry
            </button>
          </p>
        ) : (
          <DeveloperKeyControls
            api={api}
            keys={load.keys}
            claims={load.claims}
            name={name}
            setName={setName}
            scope={scope}
            setScope={setScope}
            fresh={fresh}
            setFresh={setFresh}
            copied={copied}
            setCopied={setCopied}
            busy={busy}
            setBusy={setBusy}
            refresh={refresh}
          />
        )}
      </section>
    </div>
  );
}

function DeveloperKeyControls({
  api,
  keys,
  claims,
  name,
  setName,
  scope,
  setScope,
  fresh,
  setFresh,
  copied,
  setCopied,
  busy,
  setBusy,
  refresh,
}: {
  api: Api;
  keys: ApiKey[];
  claims: Claim[];
  name: string;
  setName: (name: string) => void;
  scope: KeyScope;
  setScope: (scope: KeyScope) => void;
  fresh: { name: string; secret: string } | null;
  setFresh: (fresh: { name: string; secret: string } | null) => void;
  copied: boolean;
  setCopied: (copied: boolean) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => void;
}) {
  return (
    <>
      <p className="muted small">
        On your own computer, <code>npx @scrthq/runlog login</code> signs in through this browser and needs no key. A key is for a machine
        with nobody at it, such as CI publishing a release: set it as <code>RUNLOG_API_KEY</code> there. A key that only releases can check,
        sign, publish and release packs and nothing else, so a leaked build secret cannot reach your runs, your sales or your people.
      </p>
      {keys.map((key) => (
        <div key={key.id} className="row spread memberRow">
          <span>
            <strong>{key.name}</strong>
            <span className="muted small mono"> {key.prefix}…</span>
            {key.scope === "release" && <span className="chip state">releases only</span>}
            <span className="muted small">
              {" "}
              · made {onDay(key.createdAt)}
              {key.lastUsedAt ? `, used ${onDay(key.lastUsedAt)}` : ", never used"}
            </span>
          </span>
          <button className="ghost tiny" onClick={() => void api.revokeKey(key.id).then(refresh, () => {})}>
            Revoke
          </button>
        </div>
      ))}
      {fresh ? (
        <div className="freshKey">
          <p className="small">
            <strong>{fresh.name}</strong>: copy it now. It is not shown again.
          </p>
          <div className="licenseKey mono">{fresh.secret}</div>
          <div className="padRow">
            <button
              className="primary"
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="ghost" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
          <p className="muted small">
            In CI, set it as <code>RUNLOG_API_KEY</code>. On a machine you sit at, <code>npx @scrthq/runlog login --key</code> and paste it.
          </p>
        </div>
      ) : (
        <div className="inviteForm">
          <input
            className="textInput"
            placeholder="what this key is for, e.g. laptop"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Name for the new key"
          />
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as KeyScope)}
            aria-label="What the new key may do"
            title="A release key checks, signs, publishes and releases packs, and nothing else: the one to leave in a build server's secrets. A full key is you on every route."
          >
            <option value="release">Releases only</option>
            <option value="full">Everything</option>
          </select>
          <button
            className="primary"
            disabled={!name.trim() || busy}
            onClick={() => {
              setBusy(true);
              void api
                .createKey(name.trim(), scope)
                .then(({ key, secret }) => {
                  setFresh({ name: key.name, secret });
                  setName("");
                  refresh();
                })
                .catch(() => {})
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Making…" : "Make a key"}
          </button>
        </div>
      )}

      <h4 className="stepLabel">Signing keys you have claimed</h4>
      {claims.length === 0 ? (
        <p className="muted small">
          None yet. <code>npx @scrthq/runlog claim key.json</code> proves a signing key is yours; packs signed with it then show your name.
        </p>
      ) : (
        claims.map((claim) => (
          <div key={claim.fingerprint} className="row spread memberRow">
            <span className="mono small">{claim.fingerprint}</span>
            <button className="ghost tiny" onClick={() => void api.removeClaim(claim.fingerprint).then(refresh, () => {})}>
              Remove
            </button>
          </div>
        ))
      )}
    </>
  );
}

function onDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
