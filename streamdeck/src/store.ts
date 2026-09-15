import { initial, reduce, type DeckEvent, type DeckState } from "./state.ts";

export interface Store {
  state: DeckState;
  dispatch(e: DeckEvent): void;
  subscribe(l: (s: DeckState) => void): () => void;
}

/** The one live state, and the actions that redraw when it moves. */
export function makeStore(now: () => number = Date.now): Store {
  const listeners = new Set<(s: DeckState) => void>();
  const store: Store = {
    state: initial(),
    dispatch(e) {
      const next = reduce(store.state, e, now());
      if (next === store.state) return;
      store.state = next;
      for (const l of listeners) l(next);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return store;
}
