import { onWhoChanged } from "../storage/who.ts";

/**
 * The watch key, kept on the device that made it.
 *
 * The server keeps a hash and nothing else, which is right: a key it
 * could hand back is a key an intrusion could hand itself. But it left
 * the panel with an address it could only finish in the moment the key
 * was minted, and a person who copied it tomorrow got a placeholder and
 * a sentence explaining why.
 *
 * So the device remembers what it minted. What that risks is bounded by
 * what the key does: it opens a socket that may read and may never
 * press, and only over a run already open to watchers. Somebody with
 * this and nothing else can watch a run that was made watchable on
 * purpose. That is the same thing a widget address in a stream scene
 * already gives away.
 *
 * It never leaves the browser it was made in. Another device makes its
 * own, and making one puts the other out.
 */
const KEY = "runlog:watchKey";

/**
 * It goes when the account does.
 *
 * This key opens a socket on one account's runs, so it is that account's
 * and not this browser's. It used to outlive a sign-out, sitting in
 * localStorage for whoever opened the app next; `forgetWatchKey` existed
 * for exactly this and nothing ever called it.
 */
onWhoChanged(() => forgetWatchKey());

export function watchKeyHere(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberWatchKey(key: string): void {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* the address is complete for this tab and no longer */
  }
}

/** Kept for a sign-out that should not leave a key behind. */
export function forgetWatchKey(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do: it was never written */
  }
}
