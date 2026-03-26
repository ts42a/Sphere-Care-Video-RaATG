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
  center_id?: string;
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