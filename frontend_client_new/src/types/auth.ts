export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type LoginResponse = {
  access_token: string;
  user: AuthUser;
};

export type RegisterPayload = {
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

export type ForgotPasswordResponse = {
  success: boolean;
  email: string;
};

export type VerifyCodeResponse = {
  success: boolean;
  email: string;
};

export type ResetPasswordPayload = {
  email: string;
  password: string;
  confirmPassword: string;
};