/** A key for one change's retries: the same key every time that change is sent. */
export function newSyncKey(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid !== undefined) return uuid;
  } catch {
    // Some contexts expose randomUUID but refuse it (an insecure origin, say); random bytes still work.
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newThemeId(): string {
  return `theme_${newSyncKey()}`;
}
