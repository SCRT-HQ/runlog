import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import { InviteBanner, type IncomingInvite } from "./IncomingInvite.tsx";

/**
 * The banner an invitation link raises, at first paint, for the three
 * people who might see it: someone signed in, someone not, and someone
 * whose link is dead.
 */

const invite = { role: "player" as const, packId: "kiln", packTitle: "The Long Kiln", session: "Tuesday", inviter: "Nate", accepted: false, sentTo: "f*****@example.com", forYou: true, alreadyIn: false };
const found: IncomingInvite = { token: "tok1", peek: { found: true, invite } };
const forSomeoneElse: IncomingInvite = { token: "tok1", peek: { found: true, invite: { ...invite, forYou: false } } };

const banner = (invite: IncomingInvite, account: Account) =>
  renderToStaticMarkup(
    <AccountContext.Provider value={account}>
      <InviteBanner invite={invite} packTitle={(id) => (id === "kiln" ? "The Long Kiln" : null)} busy={false} onJoin={() => {}} onDismiss={() => {}} />
    </AccountContext.Provider>,
  );

const signedIn: Account = {
  status: "signed-in",
  user: { object: "user", id: "user_2", email: "f@example.com", emailVerified: true, profilePictureUrl: null, firstName: "Friend", lastName: null, lastSignInAt: null, externalId: undefined, createdAt: "", updatedAt: "" },
  signOut: () => {},
  getAccessToken: async () => "t",
};

describe("an invitation in a link", () => {
  it("says whose table it is and offers to join, signed in", () => {
    const html = banner(found, signedIn);
    expect(html).toContain("Nate");
    expect(html).toContain("Tuesday");
    expect(html).toContain("The Long Kiln");
    expect(html).toContain(">Join<");
  });

  it("tells the wrong account whose link it is, and offers to switch", () => {
    const html = banner(forSomeoneElse, signedIn);
    expect(html).toContain("f*****@example.com");
    expect(html).toContain("f@example.com");
    expect(html).toContain("Sign out to switch");
    expect(html).not.toContain(">Join<");
  });

  it("offers both doors to somebody signed out: sign in, or make an account", () => {
    const html = banner(found, { status: "anonymous", signIn: () => {}, signUp: () => {} });
    expect(html).toContain("Sign in to join");
    expect(html).toContain("Create an account");
    expect(html).not.toContain(">Join<");
  });

  it("says when the pack is not here, and when the link is dead", () => {
    const elsewhere: IncomingInvite = { token: "tok1", peek: { found: true, invite: { ...invite, packId: "other", packTitle: "Somebody Else Game", session: null } } };
    expect(banner(elsewhere, signedIn)).toContain("not on this device yet");
    expect(banner(elsewhere, signedIn)).toContain("Somebody Else Game");
    expect(banner(elsewhere, signedIn)).not.toContain("(other)");
    expect(banner({ token: "x", peek: { found: false } }, signedIn)).toContain("expired, was withdrawn, or was already used");
    expect(banner({ token: "x", peek: null, problem: "no API" }, signedIn)).toContain("no API");
  });
});
