import {
  loginUser,
  registerUser,
  requestPasswordReset,
  verifyResetCode,
  resetPassword,
} from "../api/auth";
import { clearSession, saveSession } from "./sessionService";
import { wsClient } from "./wsClient";
import { notificationService } from "./notificationService";

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
    emailConfirm: string;
    phone: string;
    password: string;
    confirmPassword: string;
    dateOfBirth: string;
    gender: string;
    preferredName?: string;
    centerId?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state?: string;
    postalCode?: string;
    country: string;
    guardian: {
      fullName: string;
      relationship?: string;
      guardianType: string;
      phone: string;
      email?: string;
      addressSameAsUser: boolean;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    };
    emergencyContacts: {
      fullName: string;
      relationship?: string;
      phone: string;
      alternatePhone?: string;
      email?: string;
    }[];
    registrationCompletedBy: string;
    registrationAssistedByName?: string;
    acceptTerms: boolean;
    acceptPrivacy: boolean;
    smsConsent: boolean;
  }) {
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const emailConfirm = payload.emailConfirm.trim().toLowerCase();
    const phone = payload.phone.trim();

    if (!firstName || !lastName || !email || !phone || !payload.password || !payload.confirmPassword) {
      throw new Error("Please complete all required fields");
    }

    if (email !== emailConfirm) {
      throw new Error("Email addresses do not match");
    }

    if (payload.password !== payload.confirmPassword) {
      throw new Error("Passwords do not match");
    }

    const fullName = `${firstName} ${lastName}`.trim();

    const g = payload.guardian;
    const guardianAddr =
      g.addressSameAsUser
        ? {
            address_line_1: payload.addressLine1.trim(),
            address_line_2: (payload.addressLine2 || "").trim() || undefined,
            city: payload.city.trim(),
            state: (payload.state || "").trim() || undefined,
            postal_code: (payload.postalCode || "").trim() || undefined,
            country: payload.country.trim(),
          }
        : {
            address_line_1: (g.addressLine1 || "").trim() || undefined,
            address_line_2: (g.addressLine2 || "").trim() || undefined,
            city: (g.city || "").trim() || undefined,
            state: (g.state || "").trim() || undefined,
            postal_code: (g.postalCode || "").trim() || undefined,
            country: (g.country || "").trim() || undefined,
          };

    const result = await registerUser({
      full_name: fullName,
      email,
      phone,
      password: payload.password,
      email_confirmation: emailConfirm,
      retype_password: payload.confirmPassword,
      role: "client",
      date_of_birth: payload.dateOfBirth.trim(),
      gender: payload.gender.trim(),
      preferred_name: (payload.preferredName || "").trim() || undefined,
      center_id: (payload.centerId || "").trim() || undefined,
      address_line_1: payload.addressLine1.trim(),
      address_line_2: (payload.addressLine2 || "").trim() || undefined,
      city: payload.city.trim(),
      state: (payload.state || "").trim() || undefined,
      postal_code: (payload.postalCode || "").trim() || undefined,
      country: payload.country.trim(),
      registration_completed_by: payload.registrationCompletedBy,
      registration_assisted_by_name: (payload.registrationAssistedByName || "").trim() || undefined,
      accept_terms: payload.acceptTerms,
      accept_privacy: payload.acceptPrivacy,
      sms_consent: payload.smsConsent,
      guardian: {
        full_name: g.fullName.trim(),
        relationship: (g.relationship || "").trim() || undefined,
        guardian_type: g.guardianType.trim(),
        phone: g.phone.trim(),
        email: (g.email || "").trim() || undefined,
        ...guardianAddr,
      },
      emergency_contacts: payload.emergencyContacts.map((ec) => ({
        full_name: ec.fullName.trim(),
        relationship: (ec.relationship || "").trim() || undefined,
        phone: ec.phone.trim(),
        alternate_phone: (ec.alternatePhone || "").trim() || undefined,
        email: (ec.email || "").trim() || undefined,
      })),
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
    wsClient.disconnect();
    notificationService.resetRealtime();
    await clearSession();
    return { success: true };
  },
};