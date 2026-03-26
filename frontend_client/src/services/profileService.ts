import {
  getUserProfile,
  updateUserProfilePreferences,
  updatePersonalDetails,
  updateContactInformation,
  updateProfessionalInfo,
} from "../api/profile";

export const profileService = {
  getProfile: getUserProfile,
  updatePreferences: updateUserProfilePreferences,
  updatePersonalDetails,
  updateContactInformation,
  updateProfessionalInfo,
};