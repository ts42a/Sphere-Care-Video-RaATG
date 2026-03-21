import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import { mockAuthUser, mockResetCode } from "../mock/authData";
import type { ApiActionResponse, ApiItemResponse } from "../types/api";
import type {
  ForgotPasswordResponse,
  LoginResponse,
  RegisterPayload,
  ResetPasswordPayload,
  VerifyCodeResponse,
} from "../types/auth";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<LoginResponse>>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    return response.data;
  }

  await wait(500);

  if (!email || !password) {
    throw new Error("Please enter your email and password");
  }

  return {
    access_token: "mock-access-token",
    user: {
      ...mockAuthUser,
      email,
    },
  };
}

export async function registerUser(payload: RegisterPayload): Promise<{ success: boolean }> {
  if (!USE_MOCK_API) {
    return request<ApiActionResponse>("/auth/register", {
      method: "POST",
      body: payload,
    });
  }

  await wait(500);

  if (!payload.email || !payload.phone || !payload.password || !payload.confirmPassword) {
    throw new Error("Please complete all fields");
  }

  if (payload.password !== payload.confirmPassword) {
    throw new Error("Passwords do not match");
  }

  return { success: true };
}

export async function requestPasswordReset(
  email: string
): Promise<ForgotPasswordResponse> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<ForgotPasswordResponse>>("/auth/forgot-password", {
      method: "POST",
      body: { email },
    });
    return response.data;
  }

  await wait(400);

  if (!email) {
    throw new Error("Please enter your email");
  }

  return {
    success: true,
    email,
  };
}

export async function verifyResetCode(
  email: string,
  code: string
): Promise<VerifyCodeResponse> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<VerifyCodeResponse>>("/auth/verify-reset-code", {
      method: "POST",
      body: { email, code },
    });
    return response.data;
  }

  await wait(350);

  if (code.length !== 5) {
    throw new Error("Please enter the 5 digit code");
  }

  if (code !== mockResetCode) {
    throw new Error("Invalid verification code");
  }

  return {
    success: true,
    email,
  };
}

export async function resetPassword(
  payload: ResetPasswordPayload
): Promise<{ success: boolean }> {
  if (!USE_MOCK_API) {
    return request<ApiActionResponse>("/auth/reset-password", {
      method: "POST",
      body: payload,
    });
  }

  await wait(450);

  if (!payload.password || !payload.confirmPassword) {
    throw new Error("Please enter and confirm your password");
  }

  if (payload.password !== payload.confirmPassword) {
    throw new Error("Passwords do not match");
  }

  return { success: true };
}
