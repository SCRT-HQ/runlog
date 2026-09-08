import { WorkOS } from "@workos-inc/node";
import { tracedCalls } from "./xray.js";

/**
 * WorkOS, through a keyhole.
 *
 * A publisher is a WorkOS organization: it can have several people in
 * it, its members carry an `org_id` in their tokens, and later a Stripe
 * subscription of its own. The API needs two things of WorkOS for that —
 * make an organization, put its founder in it as an admin — and, for the
 * people a publisher brings in, the memberships and invitations WorkOS
 * keeps. Invitations are WorkOS's mail and WorkOS's acceptance; the API
 * only asks for them and reads them back. The interface names those and
 * nothing else, so a test hands in a fake.
 */

export interface Member {
  membershipId: string;
  userId: string;
  role: "admin" | "member";
  email?: string;
  name?: string;
}

export interface Invitation {
  id: string;
  email: string;
  state: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  acceptedAt?: string;
}

export interface WorkOSLike {
  createOrganization(name: string): Promise<{ id: string }>;
  addMember(organizationId: string, userId: string, role: "admin" | "member"): Promise<void>;
  /** The organization's active members, with what WorkOS knows of each. */
  listMembers(organizationId: string): Promise<Member[]>;
  /** The organizations this person is an active member of, by WorkOS's book. */
  membershipsOf(userId: string): Promise<Array<{ organizationId: string; membershipId: string; role: "admin" | "member" }>>;
  removeMember(membershipId: string): Promise<void>;
  listInvitations(organizationId: string): Promise<Invitation[]>;
  /** WorkOS sends the mail. Without an organization it is an invitation to the platform itself. */
  invite(input: { email: string; organizationId?: string; role?: "admin" | "member"; inviterUserId: string }): Promise<Invitation>;
  revokeInvitation(invitationId: string): Promise<void>;
  /** The invitations to the platform this person sent, newest first, whatever their state. */
  invitationsBy(userId: string): Promise<Invitation[]>;
}

const roleOf = (slug: string | undefined): "admin" | "member" => (slug === "admin" ? "admin" : "member");

export function realWorkOS(apiKey: string): WorkOSLike {
  const workos = new WorkOS(apiKey);
  const impl: WorkOSLike = {
    async createOrganization(name) {
      const org = await workos.organizations.createOrganization({ name });
      return { id: org.id };
    },
    async addMember(organizationId, userId, role) {
      await workos.userManagement.createOrganizationMembership({ organizationId, userId, roleSlug: role });
    },
    async listMembers(organizationId) {
      const page = await workos.userManagement.listOrganizationMemberships({ organizationId, statuses: ["active"], limit: 100 });
      const out: Member[] = [];
      for (const m of page.data) {
        let email: string | undefined;
        let name: string | undefined;
        try {
          const user = await workos.userManagement.getUser(m.userId);
          email = user.email;
          name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
        } catch {
          /* a user WorkOS no longer has: listed by id */
        }
        out.push({ membershipId: m.id, userId: m.userId, role: roleOf(m.role?.slug), ...(email ? { email } : {}), ...(name ? { name } : {}) });
      }
      return out;
    },
    async membershipsOf(userId) {
      const page = await workos.userManagement.listOrganizationMemberships({ userId, statuses: ["active"], limit: 100 });
      return page.data.map((m) => ({ organizationId: m.organizationId, membershipId: m.id, role: roleOf(m.role?.slug) }));
    },
    async removeMember(membershipId) {
      await workos.userManagement.deleteOrganizationMembership(membershipId);
    },
    async listInvitations(organizationId) {
      const page = await workos.userManagement.listInvitations({ organizationId, limit: 100 });
      return page.data.filter((i) => i.state === "pending").map((i) => ({ id: i.id, email: i.email, state: i.state, expiresAt: i.expiresAt }));
    },
    async invite({ email, organizationId, role, inviterUserId }) {
      const made = await workos.userManagement.sendInvitation({ email, inviterUserId, ...(organizationId ? { organizationId, roleSlug: role ?? "member" } : {}) });
      return { id: made.id, email: made.email, state: made.state, expiresAt: made.expiresAt };
    },
    async revokeInvitation(invitationId) {
      await workos.userManagement.revokeInvitation(invitationId);
    },
    async invitationsBy(userId) {
      // WorkOS lists an environment's invitations, not one person's: a page
      // of the newest is read and the person's own kept. Enough for a
      // profile's list; a platform with thousands a day would index them.
      const page = await workos.userManagement.listInvitations({ limit: 100 });
      return page.data
        .filter((i) => i.inviterUserId === userId && !i.organizationId)
        .map((i) => ({ id: i.id, email: i.email, state: i.state, expiresAt: i.expiresAt, ...(i.acceptedAt ? { acceptedAt: i.acceptedAt } : {}) }));
    },
  };
  return tracedCalls("workos", impl);
}
