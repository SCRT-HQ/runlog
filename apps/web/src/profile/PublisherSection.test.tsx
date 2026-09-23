// Real effects, real DOM: the price field's hide-until-edit and the
// row menu's confirm both depend on a click actually landing, which
// renderToStaticMarkup cannot give us.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api, PublisherPack, PublisherView } from "../sync/client.ts";
import type { Plan } from "../sync/usePlan.ts";
import { PublisherPacks, PublisherSection } from "./PublisherSection.tsx";

const planBoundary = vi.hoisted(() => ({
  value: {
    state: {
      kind: "ready",
      ownerId: "A",
      gates: true,
      capabilities: { hostTables: false, waivePublisherFee: false, hostServers: false },
      offers: { servers: false, serversOpen: false, publishersOpen: true },
    },
    access: () => "upgrade",
    refresh: async () => {},
  } as Plan,
}));
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => planBoundary.value }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

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
    asks: notUsed,
    answerAsk: notUsed,
    mintAskKey: notUsed,
    setAskPolicy: notUsed,
    revokeAskKey: notUsed,
    streamKeys: notUsed,
    mintStreamKey: notUsed,
    revokeStreamKey: notUsed,
    putSnapshot: notUsed,
    watchAsSeat: notUsed,
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
    discordVerifyUrl: notUsed,
    claimGuild: notUsed,
    myGuilds: notUsed,
    releaseGuild: notUsed,
    setWatchParties: notUsed,
    guildPacks: notUsed,
    delegatePack: notUsed,
    undelegatePack: notUsed,
    parties: notUsed,
    openParty: notUsed,
    endParty: notUsed,
    renamePublisher: notUsed,
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

describe("a publisher's packs in the marketplace", () => {
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

    expect(container.textContent).toContain(`Remove ${onePack.head.title} from the marketplace?`);
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

describe("publisher discovery", () => {
  afterEach(cleanup);

  it("shows and retries a publisher read failure instead of offering publisher creation", async () => {
    let attempt = 0;
    const api = {
      myPublisher: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("offline");
        return null;
      }),
    } as unknown as Api;

    render(<PublisherSection api={api} />);

    expect(await screen.findByText(/publisher could not be loaded/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Become a publisher" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: "Become a publisher" })).toBeTruthy();
    expect(api.myPublisher).toHaveBeenCalledTimes(2);
  });

  it("reads the publisher plainly even with a Connect callback on the address, which the app handles", async () => {
    history.replaceState(null, "", "/?publisher=connected&destination=publishing");
    const api = {
      myPublisher: vi.fn(async () => null),
      refreshPublisherConnect: vi.fn(async () => null),
    } as unknown as Api;

    render(<PublisherSection api={api} />);

    expect(await screen.findByRole("button", { name: "Become a publisher" })).toBeTruthy();
    expect(api.refreshPublisherConnect).not.toHaveBeenCalled();
    expect(location.search).toBe("?publisher=connected&destination=publishing");
    history.replaceState(null, "", "/");
  });

  it("remembers a Connect return to Publishing for this account before leaving for Stripe", async () => {
    sessionStorage.clear();
    const publisher: PublisherView = {
      id: "pub_1",
      name: "Cinder & Salt",
      owner: true,
      connectStarted: false,
      connectReady: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const connect = deferred<{ available: false }>();
    const api = fakeApi({
      myPublisher: async () => publisher,
      connectPublisher: vi.fn(() => connect.promise),
      publisherPacks: async () => [],
      publisherMembers: async () => ({ members: [], invitations: [] }),
      sales: async () => [],
    });

    render(<PublisherSection api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up payouts" }));

    expect(JSON.parse(sessionStorage.getItem("runlog:profile-return") ?? "null")).toEqual({
      kind: "publisher-connect",
      ownerId: "A",
      destination: "publishing",
    });
    await act(async () => connect.resolve({ available: false }));
    expect(sessionStorage.getItem("runlog:profile-return")).toBeNull();
  });
});
