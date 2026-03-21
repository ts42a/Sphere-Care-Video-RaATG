import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import { mockUserProfile } from "../mock/profileData";
import type { ApiItemResponse } from "../types/api";
import type {
  ContactInformationUpdatePayload,
  PersonalDetailsUpdatePayload,
  ProfessionalInfoUpdatePayload,
  ProfileUpdatePayload,
  UserProfile,
} from "../types/profile";

let inMemoryProfile: UserProfile = { ...mockUserProfile };

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getUserProfile(): Promise<UserProfile> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<UserProfile>>("/profile");
    return response.data;
  }

  await wait(180);
  return inMemoryProfile;
}

export async function updateUserProfilePreferences(
  payload: ProfileUpdatePayload
): Promise<UserProfile> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<UserProfile>>("/profile/preferences", {
      method: "PATCH",
      body: payload,
    });
    return response.data;
  }

  await wait(140);

  inMemoryProfile = {
    ...inMemoryProfile,
    preferences: {
      ...inMemoryProfile.preferences,
      ...(payload.pushNotifications !== undefined
        ? { pushNotifications: payload.pushNotifications }
        : {}),
    },
  };

  return inMemoryProfile;
}

export async function updatePersonalDetails(
  payload: PersonalDetailsUpdatePayload
): Promise<UserProfile> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<UserProfile>>("/profile/personal", {
      method: "PATCH",
      body: payload,
    });
    return response.data;
  }

  await wait(160);

  inMemoryProfile = {
    ...inMemoryProfile,
    personal: {
      ...inMemoryProfile.personal,
      ...payload,
    },
  };

  inMemoryProfile = {
    ...inMemoryProfile,
    fullName: `${inMemoryProfile.personal.firstName} ${inMemoryProfile.personal.lastName}`,
  };

  return inMemoryProfile;
}

export async function updateContactInformation(
  payload: ContactInformationUpdatePayload
): Promise<UserProfile> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<UserProfile>>("/profile/contact", {
      method: "PATCH",
      body: payload,
    });
    return response.data;
  }

  await wait(160);

  inMemoryProfile = {
    ...inMemoryProfile,
    contact: {
      ...inMemoryProfile.contact,
      ...payload,
    },
  };

  return inMemoryProfile;
}

export async function updateProfessionalInfo(
  payload: ProfessionalInfoUpdatePayload
): Promise<UserProfile> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<UserProfile>>("/profile/professional", {
      method: "PATCH",
      body: payload,
    });
    return response.data;
  }

  await wait(160);

  inMemoryProfile = {
    ...inMemoryProfile,
    professional: {
      ...inMemoryProfile.professional,
      ...payload,
    },
  };

  return inMemoryProfile;
}
