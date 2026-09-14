import { whoIsHere } from "../apps/web/src/storage/who.ts";

/**
 * A test run is a build with nothing to sign in to.
 *
 * Storage waits to be told whose data it is holding before it opens
 * anything, which is the whole point of it: opening before the answer
 * arrives is how one account's shelf ended up in front of the next
 * person. Nothing announces an account in a test, so without this every
 * test that touches storage would sit out the wait and then be handed an
 * empty anonymous shelf.
 *
 * `local` is the honest answer rather than a convenience: it is the state
 * a copy on disk and a static page are in, and it keeps the name the
 * database has always had.
 *
 * A test about identity says otherwise for itself, by resetting the
 * modules and announcing somebody; see storage/isolation.test.ts.
 */
whoIsHere({ kind: "local" });
