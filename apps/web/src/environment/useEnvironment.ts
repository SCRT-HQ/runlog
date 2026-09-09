import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import {
  externalName,
  reconcile,
  type EnvironmentLink,
  type ExternalSubject,
  type LinkStatus,
  type RunState,
} from "@runlog/engine";

/**
 * Holding a link to the world outside, and keeping the comparison current.
 *
 * The hook owns the connection and the last snapshot; the disagreement itself
 * is computed by the engine, so what the panel renders is testable without a
 * browser or an adapter.
 */
export function useEnvironment(pack: Pack, state: RunState | null, link: EnvironmentLink | null) {
  const [status, setStatus] = useState<LinkStatus>(link?.status() ?? "disconnected");
  const [subjects, setSubjects] = useState<readonly ExternalSubject[]>([]);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!link) return;
    const snapshot = await link.snapshot();
    if (!live.current) return;
    setSubjects(snapshot.subjects);
    setStatus(link.status());
  }, [link]);

  // Anything the environment does on its own, a track added, a file renamed, 
  // must reach the panel without the player pressing refresh, or the
  // comparison is stale exactly when it is being trusted.
  useEffect(() => {
    if (!link) return;
    const stop = link.subscribe(() => void refresh());
    void refresh();
    return stop;
  }, [link, refresh]);

  const connect = useCallback(async () => {
    if (!link) return;
    setBusy(true);
    setStatus("connecting");
    try {
      setStatus(await link.connect());
      await refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  }, [link, refresh]);

  const disconnect = useCallback(() => {
    if (!link) return;
    link.disconnect();
    setSubjects([]);
    setStatus(link.status());
  }, [link]);

  /** Write the board's label onto the thing itself, where that is possible. */
  const applyLabel = useCallback(
    async (subjectId: number, externalId: string) => {
      if (!link?.applyLabel || !state) return;
      const subject = state.subjects.find((s) => s.id === subjectId);
      if (!subject) return;
      await link.applyLabel(externalId, externalName(pack, subject));
      await refresh();
    },
    [link, pack, state, refresh],
  );

  const comparison = useMemo(
    () => (state ? reconcile(pack, state, subjects) : { differences: [], matched: [] }),
    [pack, state, subjects],
  );

  return {
    link,
    status,
    busy,
    subjects,
    ...comparison,
    connect,
    disconnect,
    refresh,
    applyLabel,
    canWrite: Boolean(link?.applyLabel),
  };
}
