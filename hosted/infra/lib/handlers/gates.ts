import type { WorkOSLike } from "./workos.js";

/**
 * Release gates: whether a tier is on sale, for everyone at once.
 *
 * A launch is a WorkOS feature flag set to "on, for everyone" in the
 * dashboard, not a line in the stage's configuration and a deploy. The
 * API reads each gate's flag by slug with the key it already holds,
 * remembers the answer per container for a minute, and treats anything
 * it cannot read — no key filled in, no such flag, WorkOS down — as
 * closed, so nothing goes on sale by accident. A gate says only whether
 * a tier may be bought today; who holds a plan is Stripe's, the comp
 * flags' (`plus`, `server`, `hosted-licensing`, per person in the token)
 * and Discord's store's business, and unchanged.
 *
 * A gate is open when its flag is enabled in the environment and its
 * default value is on: the state the dashboard calls "on, everyone". A
 * flag on for some people only is not a launch, and reads as closed.
 */
export interface ReleaseGates {
  /** Runlog for servers may be bought: the Servers page offers Checkout. */
  servers: boolean;
  /** Becoming a publisher, and the hosted-licensing subscription, are offered. */
  publishers: boolean;
}

export const GATE_SLUGS: Record<keyof ReleaseGates, string> = { servers: "servers-open", publishers: "publishers-open" };

export const CLOSED: ReleaseGates = { servers: false, publishers: false };

/**
 * A reader that asks once a minute at most. `workos` answers null where
 * the environment's key is not filled, which closes every gate.
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
      warn("release gates: WorkOS is not configured here, so every tier reads as not on sale");
      return CLOSED;
    }
    const out: ReleaseGates = { ...CLOSED };
    for (const gate of Object.keys(GATE_SLUGS) as Array<keyof ReleaseGates>) {
      const slug = GATE_SLUGS[gate];
      try {
        const flag = await client.flag(slug);
        if (!flag) warn(`release gates: no flag "${slug}" in this environment; ${gate} reads as not on sale`);
        else out[gate] = flag.enabled && flag.defaultValue;
      } catch (error) {
        warn(`release gates: "${slug}" could not be read (${error instanceof Error ? error.message : String(error)}); ${gate} reads as not on sale`);
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
