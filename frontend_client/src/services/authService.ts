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
    dateOfBirth?: string;
    gender?: string;
    centerId?: string;
  }) {
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = payload.phone.trim();

    if (!firstName || !lastName || !email || !phone || !payload.password || !payload.confirmPassword) {
      throw new Error("Please complete all required fields");
    }

    if (payload.password !== payload.confirmPassword) {
      throw new Error("Passwords do not match");
    }

    const fullName = `${firstName} ${lastName}`.trim();

    const result = await registerUser({
      full_name: fullName,
      email,
      phone,
      password: payload.password,
      email_confirmation: email,
      retype_password: payload.confirmPassword,
      role: "client",
      date_of_birth: payload.dateOfBirth,
      gender: payload.gender,
      center_id: payload.centerId,
    });

    await saveSession(result.access_token, result.user);

    return result;
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