import { useEffect, useRef, useState } from "react";
import { open, type ContainerHeader } from "@runlog/rules-schema";
import { useTitle } from "../title.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";

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
  useTitle(null);
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<object | null>(null);

  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );

  const submit = () => {
    if (!key.trim() || pending.current) return;
    const request = {};
    pending.current = request;
    setBusy(true);
    setProblem(null);
    void (async () => {
      // Deriving the key is deliberately slow, 600,000 rounds, so this can
      // take a moment on a phone. The button says so rather than looking dead.
      const result = await open(data, key);
      if (pending.current !== request) return;
      pending.current = null;
      setBusy(false);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      onOpened(result.document, key);
    })();
  };

  const cancel = () => {
    pending.current = null;
    setBusy(false);
    onCancel();
  };

  return (
    <main className="main">
      <section className="panel setup sealedPackPrompt">
        <h2>{header.title ?? "A sealed pack"}</h2>
        <p className="muted">
          This copy was sold, so it is sealed. The license key came with it: check the receipt or the message it arrived in.
        </p>

        <Field
          label="License key"
          error={
            problem ? (
              <span className="notice sealedPackProblem" role="alert">
                {problem}
              </span>
            ) : undefined
          }
        >
          {(control) => (
            <input
              {...control}
              className="textInput mono"
              autoFocus
              value={key}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              onChange={(e) => {
                setKey(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              aria-label="License key"
            />
          )}
        </Field>

        <div className="padRow">
          <Button variant="primary" size="big" disabled={!key.trim()} loading={busy} loadingLabel="Opening…" onClick={submit}>
            Open it
          </Button>
          <Button onClick={cancel}>Cancel</Button>
        </div>

        <p className="muted small">
          This copy carries your name inside it, and anything you export from it will say so. It is not locked to this machine and nothing
          is checked online, but if it turns up somewhere public, it is traceable to the sale.
        </p>
      </section>
    </main>
  );
}
