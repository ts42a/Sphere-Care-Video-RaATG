import type { UserProfile } from "../types/profile";

export const mockUserProfile: UserProfile = {
  id: "profile-1",
  fullName: "John Smith",
  personal: {
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    gender: "Male",
  },
  contact: {
    email: "johnsmith@gmail.com",
    phone: "+(61) 123-4567",
  },
  communication: {
    unreadMessages: 3,
    newNotifications: 5,
  },
  professional: {
    licenseLabel: "License & certifications",
    profession: "Registered Nurse",
    department: "Primary Care",
    certifications: "RN, BLS, Patient Care Coordination",
  },
  preferences: {
    pushNotifications: true,
  },
};