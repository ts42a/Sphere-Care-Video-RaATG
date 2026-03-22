import {
  loginUser,
  registerUser,
  requestPasswordReset,
  verifyResetCode,
  resetPassword,
} from "../api/auth";
import { clearSession, saveSession } from "./sessionService";

export const authService = {
  async login(email: string, password: string) {
    const result = await loginUser(email, password);
    await saveSession(result.access_token, result.user);
    return result;
  },

  async register(payload: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
  }) {
    if (payload.password !== payload.confirmPassword) {
      throw new Error("Passwords do not match");
    }

    const fullName = `${payload.firstName} ${payload.lastName}`.trim();

    return registerUser({
      full_name: fullName,
      email: payload.email,
      phone: payload.phone,
      password: payload.password,
      role: "client",
    });
  },

  async forgotPassword(email: string) {
    return requestPasswordReset(email);
  },

  async verifyCode(email: string, code: string) {
    return verifyResetCode(email, code);
  },

  async resetPassword(payload: {
    token: string;
    password: string;
    confirmPassword: string;
  }) {
    if (payload.password !== payload.confirmPassword) {
      throw new Error("Passwords do not match");
    }

    return resetPassword({
      token: payload.token,
      new_password: payload.password,
    });
  },

  async logout() {
    await clearSession();
    return { success: true };
  },
};