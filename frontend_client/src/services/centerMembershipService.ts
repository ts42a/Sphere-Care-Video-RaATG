import {
  getCenterMembershipStatus,
  leaveCenter,
  requestCenterJoin,
  getMyInvitations,
  acceptInvitation,
  rejectInvitation,
} from "../api/centerMembership";

export const centerMembershipService = {
  getStatus: getCenterMembershipStatus,
  requestJoin: requestCenterJoin,
  leave: leaveCenter,
  getInvitations: getMyInvitations,
  acceptInvitation,
  rejectInvitation,
};
