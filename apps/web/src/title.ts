import { useEffect } from "react";

/**
 * Which copy of Runlog this build is. `prd` and no stage at all read the
 * same: the production build names nothing special. `local` is the Vite
 * dev server, or a build nobody stamped with a stage.
 */
export type Stage = "prd" | "dev" | "local" | undefined;

function readStage(): Stage {
  const raw = import.meta.env.VITE_RUNLOG_STAGE;
  if (raw === "dev" || raw === "prd") return raw;
  return import.meta.env.DEV ? "local" : undefined;
}

/** Read once, from the build that produced this bundle. */
const STAGE: Stage = readStage();

function platformFor(stage: Stage): string {
  if (stage === "dev") return "Runlog (dev)";
  if (stage === "local") return "Runlog (local)";
  return "Runlog";
}

/**
 * The tab's title: the page in view, joined to which copy of Runlog this
 * is. `where` is the page, a run's name, "Packs", a guide page's title,
 * and so on; null or empty leaves the platform half standing alone.
 */
export function titleFor(where: string | null, stage: Stage): string {
  const platform = platformFor(stage);
  return where ? `${where} · ${platform}` : platform;
}

/**
 * The run in hand, named for the tab: `<run name> · <pack title>`, or
 * just the pack's title where the run has no name, or only whitespace.
 */
export function runTitle(name: string | null | undefined, packTitle: string): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} · ${packTitle}` : packTitle;
}

/**
 * Sets the tab's title for the screen in view. One effect, no cleanup:
 * the next screen mounted sets its own title over this one's.
 */
export function useTitle(current: string | null): void {
  useEffect(() => {
    document.title = titleFor(current, STAGE);
  }, [current]);
}
