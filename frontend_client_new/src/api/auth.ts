import { mockAuthUser, mockResetCode } from "../mock/authData";
import { API_BASE_URL, USE_MOCK_API } from "../config/api";
import type {
  ForgotPasswordResponse,
  LoginResponse,
  RegisterPayload,
  ResetPasswordPayload,
  VerifyCodeResponse,
  AuthUser,
} from "../types/auth";

const USE_MOCK_AUTH = USE_MOCK_API;

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

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return await response.text();
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data));
  }

  return data as T;
}

function normalizeLoginResponse(data: any, email: string): LoginResponse {
  const user: AuthUser = data?.user ?? {
    id: data?.id ?? 0,
    full_name: data?.full_name ?? data?.name ?? email.split("@")[0] ?? "User",
    email: data?.email ?? email,
    phone: data?.phone ?? "",
    role: data?.role ?? "client",
    created_at: data?.created_at,
    account_status: data?.account_status,
  };

  return {
    access_token: data?.access_token ?? data?.token ?? "",
    token_type: data?.token_type ?? "bearer",
    user,
  };
}

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  if (USE_MOCK_AUTH) {
    await wait(500);

    if (!email || !password) {
      throw new Error("Please enter your email and password");
    }

    return {
      access_token: "mock-access-token",
      token_type: "bearer",
      user: {
        ...mockAuthUser,
        email,
      },
    };
  }

  if (!email || !password) {
    throw new Error("Please enter your email and password");
  }

  try {
    const jsonResult = await request<any>("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const normalized = normalizeLoginResponse(jsonResult, email);

    if (!normalized.access_token) {
      throw new Error("Login succeeded but token was not returned");
    }

    return normalized;
  } catch (jsonError) {
    const formBody = new URLSearchParams();
    formBody.append("username", email);
    formBody.append("password", password);

    const formResponse = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    });

    const formData = await parseResponse(formResponse);

    if (!formResponse.ok) {
      throw new Error(getErrorMessage(formData));
    }

    const normalized = normalizeLoginResponse(formData, email);

    if (!normalized.access_token) {
      throw new Error("Login succeeded but token was not returned");
    }

    return normalized;
  }
}

export async function registerUser(
  payload: RegisterPayload
): Promise<{ success: boolean }> {
  if (USE_MOCK_AUTH) {
    await wait(500);
    return { success: true };
  }

  return request<{ success: boolean }>("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function requestPasswordReset(
  email: string
): Promise<ForgotPasswordResponse> {
  if (USE_MOCK_AUTH) {
    await wait(400);

    if (!email) {
      throw new Error("Please enter your email");
    }

    return {
      message: "If that email exists, a reset link has been sent.",
    };
  }

  return request<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
}

export async function verifyResetCode(
  email: string,
  code: string
): Promise<VerifyCodeResponse> {
  if (USE_MOCK_AUTH) {
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

  return request<VerifyCodeResponse>("/auth/verify-reset-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, code }),
  });
}

export async function resetPassword(
  payload: ResetPasswordPayload
): Promise<{ success: boolean }> {
  if (USE_MOCK_AUTH) {
    await wait(450);
    return { success: true };
  }

  return request<{ success: boolean }>("/auth/reset-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}