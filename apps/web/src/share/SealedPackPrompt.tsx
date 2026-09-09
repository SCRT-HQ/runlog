import { useState } from "react";
import { open, type ContainerHeader } from "@runlog/rules-schema";

/**
 * Opening a copy that was sold to somebody.
 *
 * The prompt is deliberately unapologetic about what it is. A buyer who paid
 * for this should not be made to feel accused, and a person who did not should
 * not be left guessing, so it says plainly that the file is theirs, that the
 * key came with it, and that their name is inside.
 *
 * The key is remembered, because retyping it every session would make an
 * honest customer's life worse than a dishonest one's.
 */
export function SealedPackPrompt({
  data,
  header,
  onOpened,
  onCancel,
}: {
  data: Uint8Array;
  header: ContainerHeader;
  onOpened: (document: unknown, licenseKey: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    void (async () => {
      // Deriving the key is deliberately slow, 600,000 rounds, so this can
      // take a moment on a phone. The button says so rather than looking dead.
      const result = await open(data, key);
      setBusy(false);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      onOpened(result.document, key);
    })();
  };

  return (
    <main className="main">
      <section className="panel setup">
        <h2>{header.title ?? "A sealed pack"}</h2>
        <p className="muted">
          This copy was sold, so it is sealed. The license key came with it: check the
          receipt or the message it arrived in.
        </p>

        <h3 className="sectionTitle">License key</h3>
        <input
          className="textInput mono"
          autoFocus
          value={key}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-label="License key"
        />

        {problem && <div className="notice">{problem}</div>}

        <div className="padRow">
          <button className="primary big" disabled={!key.trim() || busy} onClick={submit}>
            {busy ? "Opening…" : "Open it"}
          </button>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <p className="muted small">
          This copy carries your name inside it, and anything you export from it will say
          so. It is not locked to this machine and nothing is checked online, but if it
          turns up somewhere public, it is traceable to the sale.
        </p>
      </section>
    </main>
  );
}
