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
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
  }) {
    return registerUser(payload);
  },

  async forgotPassword(email: string) {
    return requestPasswordReset(email);
  },

  async verifyCode(email: string, code: string) {
    return verifyResetCode(email, code);
  },

  async resetPassword(payload: {
    email: string;
    password: string;
    confirmPassword: string;
  }) {
    return resetPassword(payload);
  },

  async logout() {
    await clearSession();
    return { success: true };
  },
};