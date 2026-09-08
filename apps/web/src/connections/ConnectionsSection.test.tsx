import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountContext, type Account } from "../auth/Account.tsx";
import type { Api } from "../sync/client.ts";
import { ConnectionsSection } from "./ConnectionsSection.tsx";

/**
 * The section at first paint, which is what decides whether a person who
 * followed the bot's address knows what they are being asked. Static
 * markup, so nothing is fetched.
 */
const signedIn: Account = { status: "signed-in", user: { id: "u1", email: "mira@example.com" } as Account extends { user: infer U } ? U : never, signOut: () => {}, getAccessToken: async () => "t" } as Account;
const anonymous: Account = { status: "anonymous", signIn: () => {}, signUp: () => {} };
const api = {} as Api;

const render = (account: Account, props: Parameters<typeof ConnectionsSection>[0]) =>
  renderToStaticMarkup(
    <AccountContext.Provider value={account}>
      <ConnectionsSection {...props} />
    </AccountContext.Provider>,
  );

describe("the linked-accounts section", () => {
  it("asks before binding a code that arrived by address, naming the account it would bind to", () => {
    const html = render(signedIn, { api, pending: { kind: "discord", code: "ABCDEF" } });
    expect(html).toContain("Discord asked to link an account to this one");
    expect(html).toContain("mira@example.com");
    expect(html).toContain("Link to this account");
    expect(html).toContain("Not now");
  });

  it("offers sign-in first when nobody is signed in, and keeps the code for after", () => {
    const html = render(anonymous, { api: null, pending: { kind: "discord", code: "ABCDEF" } });
    expect(html).toContain("Sign in to link");
    expect(html).toContain("Create an account");
    expect(html).toContain("the code waits");
  });

  it("says what to do with nothing pending and nobody signed in", () => {
    const html = render(anonymous, { api: null, pending: null });
    expect(html).toContain("Sign in, and the accounts linked");
    expect(html).not.toContain("Discord asked");
  });
});
