import type { Diagnostic } from "@runlog/rules-schema";
import { useTitle } from "./title.ts";
import { Severity } from "./ui/Severity.tsx";

/** A pack that did not load: each problem with its severity said in words, its code, where, and why. */
export function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  useTitle(null);
  return (
    <main className="diagnostics">
      <h2>This pack did not load</h2>
      <p className="muted">The same three gates the engine uses: version, then shape, then coherence.</p>
      <ul>
        {diagnostics.map((d, i) => (
          <li key={i} className={d.level}>
            <Severity level={d.level} show="word" />
            <span className="code">{d.code}</span>
            {d.path && <span className="path">{d.path}</span>}
            <p>{d.message}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
