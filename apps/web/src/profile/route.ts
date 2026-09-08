/**
 * The profile's pages, addressed in the hash: `#profile`,
 * `#profile/publishing`, `#profile/account`, `#profile/social`,
 * `#profile/servers`. Bare `#profile` is the first page, the same way a
 * bare `#guide` is its first page. Kept apart from ProfileView.tsx so
 * App.tsx can read a page out of the address bar without importing the
 * whole view.
 */
export const PROFILE_PAGES = [
  { id: "profile", label: "Profile" },
  { id: "publishing", label: "Publishing" },
  { id: "account", label: "Account" },
  { id: "social", label: "Social" },
  { id: "servers", label: "Servers" },
] as const;

export type ProfilePage = (typeof PROFILE_PAGES)[number]["id"];

const IDS = new Set<string>(PROFILE_PAGES.map((p) => p.id));

/** The page named in `#profile` or `#profile/<page>`; null where the hash names no profile page at all. */
export function profilePageFromHash(hash: string): ProfilePage | null {
  const m = /^#profile(?:\/([a-z]+))?$/.exec(hash);
  if (!m) return null;
  const page = m[1];
  return page && IDS.has(page) ? (page as ProfilePage) : "profile";
}

/** The address for a page, so a link to it survives a reload. */
export function profileHash(page: ProfilePage): string {
  return page === "profile" ? "#profile" : `#profile/${page}`;
}
