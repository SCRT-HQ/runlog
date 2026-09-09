import { appBase, hrefFor } from "../route.ts";
/**
 * A dock's address: `#dock/controls/<runId>`. The run's remote — the next
 * move, the last result, undo — alone on the page, for a streaming app
 * that keeps a signed-in web page docked beside its preview. Unlike a
 * widget it is not read by a live link: the dock is a second device at
 * the table, signed in as its owner, and the run must be on it.
 */
export interface DockRoute {
  kind: "controls";
  runId: string;
}

export function dockFromHash(hash: string): DockRoute | null {
  const m = /^#dock\/controls\/([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? { kind: "controls", runId: m[1]! } : null;
}

export function dockHash(route: DockRoute): string {
  return `#dock/${route.kind}/${route.runId}`;
}

/** The full address, for a custom browser dock. */
export function dockHref(route: DockRoute, base: string = location.href): string {
  return new URL(hrefFor(dockHash(route)), new URL(appBase(base), base)).toString();
}
