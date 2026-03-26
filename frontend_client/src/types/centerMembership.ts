export type CenterJoinRequest = {
  id: number;
  client_user_id: number;
  client_email: string;
  client_full_name: string;
  admin_id: number;
  center_code: string;
  center_name: string;
  status: "pending" | "approved" | "rejected" | "left";
  initiated_by: "client" | "admin";
  request_message?: string | null;
  rejection_reason?: string | null;
  requested_at: string;
  reviewed_at?: string | null;
  approved_at?: string | null;
  left_at?: string | null;
};

export type CenterMembershipStatus = {
  is_member: boolean;
  membership_status: "none" | "pending" | "approved";
  joined_center_admin_id?: number | null;
  joined_center_code?: string | null;
  joined_center_name?: string | null;
  pending_request?: CenterJoinRequest | null;
  latest_request?: CenterJoinRequest | null;
};
