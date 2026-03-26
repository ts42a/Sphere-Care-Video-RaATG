export type AuthUser = {
  id: number;
  full_name: string;
  email: string;
  phone?: string;
  role: string;
  created_at?: string;
  account_status?: string;
  unique_code?: string;
};

export type LoginResponse = {
  access_token: string;
  token_type?: string;
  user: AuthUser;
};

export type ClientGuardianPayload = {
  full_name: string;
  relationship?: string;
  guardian_type: string;
  phone?: string;
  email?: string;
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

export type ClientEmergencyContactPayload = {
  full_name: string;
  relationship?: string;
  phone: string;
  alternate_phone?: string;
  email?: string;
};

export type RegisterPayload = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  email_confirmation?: string;
  retype_password?: string;
  role?: string;
  date_of_birth?: string;
  gender?: string;
  preferred_name?: string;
  center_id?: string;
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  registration_completed_by?: string;
  registration_assisted_by_name?: string;
  accept_terms?: boolean;
  accept_privacy?: boolean;
  sms_consent?: boolean;
  guardian?: ClientGuardianPayload;
  emergency_contacts?: ClientEmergencyContactPayload[];
};

export type RegisterResponse = {
  access_token: string;
  token_type?: string;
  user: AuthUser;
};

export type ForgotPasswordResponse = {
  message: string;
};

export type VerifyCodeResponse = {
  success: boolean;
  email: string;
};

export type ResetPasswordPayload = {
  token: string;
  new_password: string;
};