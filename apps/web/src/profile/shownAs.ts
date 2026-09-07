import type { Profile } from "../sync/client.ts";

/** How a person is shown to others: the name they chose, else the one WorkOS holds, else nothing. */
export function shownAs(profile: Pick<Profile, "name" | "handle"> | null | undefined): string | undefined {
  return profile?.handle?.trim() || profile?.name?.trim() || undefined;
}
