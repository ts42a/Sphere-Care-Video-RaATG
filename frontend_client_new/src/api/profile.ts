import { mockUserProfile } from "../mock/profileData";
import type {
  ContactInformationUpdatePayload,
  PersonalDetailsUpdatePayload,
  ProfessionalInfoUpdatePayload,
  ProfileUpdatePayload,
  UserProfile,
} from "../types/profile";

const USE_MOCK_PROFILE = true;
const API_BASE_URL = "http://127.0.0.1:8000";

let inMemoryProfile: UserProfile = { ...mockUserProfile };

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Request failed");
  }

  return data as T;
}

export async function getUserProfile(): Promise<UserProfile> {
  if (!USE_MOCK_PROFILE) {
    return request<UserProfile>("/profile", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  await wait(180);
  return inMemoryProfile;
}

export async function updateUserProfilePreferences(
  payload: ProfileUpdatePayload
): Promise<UserProfile> {
  if (!USE_MOCK_PROFILE) {
    return request<UserProfile>("/profile/preferences", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
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
  if (!USE_MOCK_PROFILE) {
    return request<UserProfile>("/profile/personal", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
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
  if (!USE_MOCK_PROFILE) {
    return request<UserProfile>("/profile/contact", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
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
  if (!USE_MOCK_PROFILE) {
    return request<UserProfile>("/profile/professional", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
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