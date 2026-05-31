jest.mock("../src/api/auth", () => ({
  loginUser: jest.fn(),
  registerUser: jest.fn(),
  requestPasswordReset: jest.fn(),
  verifyResetCode: jest.fn(),
  resetPassword: jest.fn(),
}));

jest.mock("../src/services/sessionService", () => ({
  saveSession: jest.fn().mockResolvedValue(undefined),
  clearSession: jest.fn().mockResolvedValue(undefined),
  getAccessToken: jest.fn(),
  getStoredUser: jest.fn(),
}));

jest.mock("../src/services/wsClient", () => ({
  wsClient: { disconnect: jest.fn() },
}));

jest.mock("../src/services/notificationService", () => ({
  notificationService: { resetRealtime: jest.fn() },
}));

import { authService } from "../src/services/authService";
import { loginUser } from "../src/api/auth";
import { saveSession } from "../src/services/sessionService";
import { wsClient } from "../src/services/wsClient";

const mockLoginUser = loginUser as jest.MockedFunction<typeof loginUser>;
const mockSaveSession = saveSession as jest.MockedFunction<typeof saveSession>;

const BASE_PAYLOAD = {
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  emailConfirm: "john@example.com",
  phone: "0400000000",
  password: "Secret123!",
  confirmPassword: "Secret123!",
  dateOfBirth: "1950-01-01",
  gender: "male",
  addressLine1: "1 Main St",
  city: "Sydney",
  country: "Australia",
  registrationCompletedBy: "self",
  acceptTerms: true,
  acceptPrivacy: true,
  smsConsent: false,
  guardian: {
    fullName: "Jane Doe",
    guardianType: "parent",
    phone: "0411111111",
    addressSameAsUser: false,
  },
  emergencyContacts: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("test_authService_login_saves_session", async () => {
  const fakeResult = { access_token: "tok123", user: { id: 1 } };
  mockLoginUser.mockResolvedValue(fakeResult as any);

  await authService.login("user@test.com", "pass");

  expect(mockSaveSession).toHaveBeenCalledWith("tok123", { id: 1 });
});

test("test_authService_login_throws_on_api_error", async () => {
  mockLoginUser.mockRejectedValue(new Error("Invalid credentials"));

  await expect(authService.login("bad@test.com", "wrong")).rejects.toThrow(
    "Invalid credentials"
  );
});

test("test_authService_logout_disconnects_ws", async () => {
  await authService.logout();
  expect(wsClient.disconnect).toHaveBeenCalled();
});

test("test_authService_register_throws_on_email_mismatch", async () => {
  await expect(
    authService.register({ ...BASE_PAYLOAD, emailConfirm: "other@example.com" })
  ).rejects.toThrow("Email addresses do not match");
});

test("test_authService_register_throws_on_password_mismatch", async () => {
  await expect(
    authService.register({ ...BASE_PAYLOAD, confirmPassword: "Different1!" })
  ).rejects.toThrow("Passwords do not match");
});
