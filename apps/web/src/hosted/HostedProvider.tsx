import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadHosted, type Hosted } from "./config.ts";

/**
 * The hosted words, for whatever wants them: the footer, the terms gate,
 * the guide's badges. Null until the file has been read, and null for
 * good where there is none: a copy on disk, on Pages, or in dev. The
 * first paint never waits on it.
 */
const HostedContext = createContext<Hosted | null>(null);

export function useHosted(): Hosted | null {
  return useContext(HostedContext);
}

export function HostedProvider({ children, value }: { children: ReactNode; value?: Hosted | null }) {
  const [hosted, setHosted] = useState<Hosted | null>(value ?? null);
  useEffect(() => {
    if (value !== undefined) return;
    let live = true;
    void loadHosted().then((h) => live && setHosted(h));
    return () => {
      live = false;
    };
  }, [value]);
  return <HostedContext.Provider value={hosted}>{children}</HostedContext.Provider>;
}
