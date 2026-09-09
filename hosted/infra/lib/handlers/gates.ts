import type { WorkOSLike } from "./workos.js";

/**
 * Release gates: whether a tier is on sale, for everyone at once.
 *
 * A tier is on sale unless a hold says otherwise. The hold is a WorkOS
 * feature flag, `servers-coming-soon` or `publishers-coming-soon`, set to
 * "on, for everyone" in the dashboard; the API reads it by slug with the
 * key it already holds, once a minute per container, and shows the tier
 * as coming while the hold stands. A launch is the hold turned off, or
 * the flag deleted: nothing to deploy, nothing left behind. A flag that
 * is off, on for some people only, missing, or unreadable (no key filled
 * in, WorkOS down) is no hold, so the tier reads as open.
 *
 * A gate says only whether a tier may be bought today; who holds a plan
 * is Stripe's, the comp flags' (`plus`, `server`, `hosted-licensing`, per
 * person in the token) and Discord's store's business, and unchanged.
 */
export interface ReleaseGates {
  /** Runlog for servers may be bought: the Servers page offers Checkout. */
  servers: boolean;
  /** Becoming a publisher, and the hosted-licensing subscription, are offered. */
  publishers: boolean;
}

/** The flag that holds each tier back while it stands. */
export const HOLD_SLUGS: Record<keyof ReleaseGates, string> = { servers: "servers-coming-soon", publishers: "publishers-coming-soon" };

export const OPEN: ReleaseGates = { servers: true, publishers: true };

/**
 * A reader that asks once a minute at most. `workos` answers null where
 * the environment's key is not filled, which is no hold: every tier is
 * open, and the log says why.
 */
export function gateReader(
  workos: () => Promise<WorkOSLike | null>,
  options: { ttlMs?: number; now?: () => number; warn?: (message: string) => void } = {},
): () => Promise<ReleaseGates> {
  const ttl = options.ttlMs ?? 60_000;
  const clock = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  let kept: { gates: ReleaseGates; at: number } | null = null;
  let reading: Promise<ReleaseGates> | null = null;
  const read = async (): Promise<ReleaseGates> => {
    const client = await workos();
    if (!client) {
      warn("release gates: WorkOS is not configured here, so no hold can be read and every tier is on sale");
      return { ...OPEN };
    }
    const out: ReleaseGates = { ...OPEN };
    for (const gate of Object.keys(HOLD_SLUGS) as Array<keyof ReleaseGates>) {
      const slug = HOLD_SLUGS[gate];
      try {
        const flag = await client.flag(slug);
        // A hold is a flag on for everyone; anything less is not one.
        if (flag) out[gate] = !(flag.enabled && flag.defaultValue);
      } catch (error) {
        warn(`release gates: "${slug}" could not be read (${error instanceof Error ? error.message : String(error)}); ${gate} reads as on sale`);
      }
    }
    return out;
  };
  return async () => {
    const at = clock();
    if (kept && at - kept.at < ttl) return kept.gates;
    // One read at a time: a burst of requests on a cold container shares it.
    reading ??= read()
      .then((gates) => {
        kept = { gates, at: clock() };
        return gates;
      })
      .finally(() => {
        reading = null;
      });
    return reading;
  };
}
