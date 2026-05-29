import { request } from "./client";
import { getAccessToken } from "../services/sessionService";
import type { CenterJoinRequest, CenterMembershipStatus } from "../types/centerMembership";

async function requireToken() {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Please log in again.");
  }
  return token;
}

export async function getCenterMembershipStatus(): Promise<CenterMembershipStatus> {
  const token = await requireToken();
  return request<CenterMembershipStatus>("/center-membership/me", {
    method: "GET",
    token,
  });
}

export async function requestCenterJoin(centerId: string, message?: string): Promise<CenterJoinRequest> {
  const token = await requireToken();
  return request<CenterJoinRequest>("/center-membership/request", {
    method: "POST",
    token,
    body: {
      center_id: centerId,
      message: message || undefined,
    },
  });
}

export async function leaveCenter(password: string): Promise<{ success: boolean; msg?: string }> {
  const token = await requireToken();
  return request<{ success: boolean; msg?: string }>("/center-membership/leave", {
    method: "POST",
    token,
    body: { password },
  });
}

export async function getMyInvitations(): Promise<CenterJoinRequest[]> {
  const token = await requireToken();
  return request<CenterJoinRequest[]>("/center-membership/invitations/me", {
    method: "GET",
    token,
  });
}

export async function acceptInvitation(invitationId: number): Promise<CenterJoinRequest> {
  const token = await requireToken();
  return request<CenterJoinRequest>(`/center-membership/invitations/${invitationId}/accept`, {
    method: "POST",
    token,
  });
}

export async function rejectInvitation(invitationId: number): Promise<CenterJoinRequest> {
  const token = await requireToken();
  return request<CenterJoinRequest>(`/center-membership/invitations/${invitationId}/reject`, {
    method: "POST",
    token,
  });
}
