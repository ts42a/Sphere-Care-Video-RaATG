export type ProfileContact = {
  email: string;
  phone: string;
};

export type ProfileCommunication = {
  unreadMessages: number;
  newNotifications: number;
};

export type ProfileProfessional = {
  licenseLabel: string;
  profession: string;
  department: string;
  certifications: string;
};

export type ProfilePreferences = {
  pushNotifications: boolean;
};

export type ProfilePersonal = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
};

export type UserProfile = {
  id: string;
  fullName: string;
  personal: ProfilePersonal;
  contact: ProfileContact;
  communication: ProfileCommunication;
  professional: ProfileProfessional;
  preferences: ProfilePreferences;
};

export type ProfileUpdatePayload = {
  pushNotifications?: boolean;
};

export type PersonalDetailsUpdatePayload = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
};

export type ContactInformationUpdatePayload = {
  email?: string;
  phone?: string;
};

export type ProfessionalInfoUpdatePayload = {
  profession?: string;
  department?: string;
  certifications?: string;
};