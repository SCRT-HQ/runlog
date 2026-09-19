/**
 * The profile's pages, addressed in the hash: `#profile`,
 * `#profile/publishing`, `#profile/developer`, `#profile/account`, `#profile/social`,
 * `#profile/servers`. Bare `#profile` is the first page, the same way a
 * bare `#guide` is its first page. Kept apart from ProfileView.tsx so
 * App.tsx can read a page out of the address bar without importing the
 * whole view.
 */
export type ProfilePage = "profile" | "publishing" | "developer" | "account" | "social" | "servers" | "settings";
export type ProfileAudience = "any" | "account";
export type ProfileApplicability = "always" | "servers";
export type ServerAvailability = "checking" | "available" | "unavailable" | "error";

export interface ProfilePageDescriptor {
  id: ProfilePage;
  label: string;
  audience: ProfileAudience;
  applicability: ProfileApplicability;
}

export type ProfileRouteAccess =
  | { kind: "content"; page: ProfilePage }
  | { kind: "checking" }
  | { kind: "sign-in" }
  | { kind: "replace"; page: "settings" }
  | { kind: "unavailable"; page: "servers" }
  | { kind: "error"; page: "servers" };

export const PROFILE_PAGES = [
  { id: "profile", label: "Profile", audience: "account", applicability: "always" },
  { id: "publishing", label: "Publishing", audience: "account", applicability: "always" },
  { id: "developer", label: "Developer keys", audience: "account", applicability: "always" },
  { id: "account", label: "Account", audience: "account", applicability: "always" },
  { id: "social", label: "Social", audience: "account", applicability: "always" },
  { id: "servers", label: "Servers", audience: "account", applicability: "servers" },
  { id: "settings", label: "Settings", audience: "any", applicability: "always" },
] as const satisfies readonly ProfilePageDescriptor[];

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

export function profileAccessFor(
  page: ProfilePage,
  account: "local" | "checking" | "anonymous" | "signed-in",
  servers: ServerAvailability,
): ProfileRouteAccess {
  if (page === "settings") return { kind: "content", page };
  if (account === "local") return { kind: "replace", page: "settings" };
  if (account === "checking") return { kind: "checking" };
  if (account === "anonymous") return { kind: "sign-in" };
  if (page !== "servers") return { kind: "content", page };
  if (servers === "available") return { kind: "content", page };
  if (servers === "checking") return { kind: "checking" };
  return { kind: servers, page };
}

export function visibleProfilePages(
  account: "local" | "checking" | "anonymous" | "signed-in",
  servers: ServerAvailability,
  current: ProfilePage,
): readonly ProfilePageDescriptor[] {
  return PROFILE_PAGES.filter((page) => {
    if (account !== "signed-in") return page.audience === "any";
    if (page.applicability === "always") return true;
    return servers === "available" || current === page.id;
  });
}
