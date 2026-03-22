import { mockAuthUser, mockResetCode } from "../mock/authData";
import type {
  ForgotPasswordResponse,
  LoginResponse,
  RegisterPayload,
  ResetPasswordPayload,
  VerifyCodeResponse,
} from "../types/auth";

const USE_MOCK_AUTH = false;
const API_BASE_URL = "http://192.168.1.107:8000";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(data: any) {
  if (typeof data?.detail === "string") return data.detail;
  if (typeof data?.detail?.msg === "string") return data.detail.msg;
  if (Array.isArray(data?.detail)) return data.detail[0]?.msg || "Request failed";
  if (typeof data?.message === "string") return data.message;
  return "Request failed";
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);

  let data: any = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(data));
  }

  return data as T;
}

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  if (!USE_MOCK_AUTH) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
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
  if (!USE_MOCK_AUTH) {
    return request<{ success: boolean }>("/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  await wait(500);

  return { success: true };
}

export async function requestPasswordReset(
  email: string
): Promise<ForgotPasswordResponse> {
  if (!USE_MOCK_AUTH) {
    return request<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
  }

  await wait(400);

  if (!email) {
    throw new Error("Please enter your email");
  }

  return {
    message: "If that email exists, a reset link has been sent.",
  };
}

export async function verifyResetCode(
  email: string,
  code: string
): Promise<VerifyCodeResponse> {
  if (!USE_MOCK_AUTH) {
    return request<VerifyCodeResponse>("/auth/verify-reset-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, code }),
    });
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
  if (!USE_MOCK_AUTH) {
    return request<{ success: boolean }>("/auth/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  await wait(450);

  return { success: true };
}
