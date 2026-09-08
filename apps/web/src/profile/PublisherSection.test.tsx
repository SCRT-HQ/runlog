// Real effects, real DOM: the price field's hide-until-edit and the
// row menu's confirm both depend on a click actually landing, which
// renderToStaticMarkup cannot give us.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Api, PublisherPack, PublisherView } from "../sync/client.ts";
import { PublisherPacks } from "./PublisherSection.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every call this component might make, none of it exercised unless a test says so. */
const notUsed = async (): Promise<never> => {
  throw new Error("not used in this test");
};

function fakeApi(overrides: Partial<Api>): Api {
  const base = {
    me: notUsed,
    putProfile: notUsed,
    deleteMe: notUsed,
    exportMe: notUsed,
    manifest: notUsed,
    createSession: notUsed,
    getSession: notUsed,
    appendEvents: notUsed,
    patchSession: notUsed,
    deleteSession: notUsed,
    createInvite: notUsed,
    listInvites: notUsed,
    revokeInvite: notUsed,
    acceptInvite: notUsed,
    myInvites: notUsed,
    declineInvite: notUsed,
    shareRun: notUsed,
    unshareRun: notUsed,
    watchPublicRun: notUsed,
    reactions: notUsed,
    react: notUsed,
    putSnapshot: notUsed,
    removeMember: notUsed,
    people: notUsed,
    checkout: notUsed,
    portal: notUsed,
    refreshEntitlements: notUsed,
    myPublisher: notUsed,
    becomePublisher: notUsed,
    connectPublisher: notUsed,
    refreshPublisherConnect: notUsed,
    publisherDashboard: notUsed,
    publisherMembers: notUsed,
    invitePublisherMember: notUsed,
    revokePublisherInvitation: notUsed,
    removePublisherMember: notUsed,
    inviteFriend: notUsed,
    myInvitations: notUsed,
    revokeFriendInvitation: notUsed,
    startPurchase: notUsed,
    purchase: notUsed,
    purchaseFile: notUsed,
    myPurchases: notUsed,
    sales: notUsed,
    reissueSale: notUsed,
    revokeSale: notUsed,
    publisherPacks: notUsed,
    putPublisherPack: notUsed,
    listPublisherPack: notUsed,
    unlistPublisherPack: notUsed,
    deletePublisherPack: notUsed,
    createRace: notUsed,
    myRaces: notUsed,
    joinRace: notUsed,
    getRace: notUsed,
    putRaceEntry: notUsed,
    patchRace: notUsed,
    inviteToRace: notUsed,
    listKeys: notUsed,
    createKey: notUsed,
    revokeKey: notUsed,
    listClaims: notUsed,
    removeClaim: notUsed,
    claimNonce: notUsed,
    claim: notUsed,
    getPack: notUsed,
    putPack: notUsed,
    deletePack: notUsed,
    getLicense: notUsed,
    putLicense: notUsed,
    deleteLicense: notUsed,
    connections: notUsed,
    linkDiscord: notUsed,
    unlinkDiscord: notUsed,
    claimGuild: notUsed,
    myGuilds: notUsed,
    releaseGuild: notUsed,
    guildPacks: notUsed,
    delegatePack: notUsed,
    undelegatePack: notUsed,
  } satisfies Api;
  return { ...base, ...overrides };
}

const publisher: PublisherView = {
  id: "pub_1",
  name: "Cinder & Salt",
  owner: true,
  connectStarted: true,
  connectReady: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const onePack: PublisherPack = {
  packId: "pack_1",
  head: { title: "Ember Trail", version: "1.0.0", category: "other", tags: [], features: [], players: 1 },
  price: { amount: 400, currency: "usd" },
  status: "listed",
  bytes: 1024,
  updatedAt: "2026-01-01T00:00:00Z",
};

/** A handful of microtask turns, enough for the mount effect's fetch and its follow-on render to settle. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("a publisher's packs in the catalog", () => {
  let root: Root;
  let container: HTMLElement;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(api: Api) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<PublisherPacks api={api} publisher={publisher} />);
    });
    await settle();
  }

  it("shows the price as text, not a field, until edit is pressed", async () => {
    await mount(fakeApi({ publisherPacks: async () => [onePack] }));

    expect(container.textContent).toContain("$4");
    expect(container.querySelector('input[aria-label^="Price for"]')).toBeNull();

    const edit = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "edit");
    expect(edit).toBeTruthy();
    act(() => edit!.click());

    const input = container.querySelector('input[aria-label^="Price for"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input!.value).toBe("4");
  });

  it("keeps Unlist and Remove in the row's own menu, not loose in the row", async () => {
    await mount(fakeApi({ publisherPacks: async () => [onePack] }));

    // Neither acts as a bare button outside the menu.
    const looseButtons = Array.from(container.querySelectorAll("span.row > button")).map((b) => b.textContent);
    expect(looseButtons).not.toContain("Unlist");
    expect(looseButtons).not.toContain("Remove");

    const menu = container.querySelector("details.rowMenu") as HTMLDetailsElement;
    expect(menu).toBeTruthy();
    act(() => {
      menu.open = true;
      menu.dispatchEvent(new Event("toggle"));
    });
    const menuButtons = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent);
    expect(menuButtons).toContain("Unlist");
    expect(menuButtons).toContain("Remove");
  });

  it("confirms Remove with the pack's own name before it calls the API", async () => {
    let removed = false;
    await mount(
      fakeApi({
        publisherPacks: async () => [onePack],
        deletePublisherPack: async (id) => {
          expect(id).toBe(onePack.packId);
          removed = true;
        },
      }),
    );

    const menu = container.querySelector("details.rowMenu") as HTMLDetailsElement;
    act(() => {
      menu.open = true;
      menu.dispatchEvent(new Event("toggle"));
    });
    const remove = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent === "Remove") as HTMLButtonElement;
    act(() => remove.click());

    expect(container.textContent).toContain(`Remove ${onePack.head.title} from the catalog?`);
    expect(removed).toBe(false);

    const confirm = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Yes, remove it") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    await settle();
    expect(removed).toBe(true);
  });
});
