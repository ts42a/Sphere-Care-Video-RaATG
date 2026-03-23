const API_BASE = ""; // keep empty if same origin

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
}

function authHeaders(json = true) {
  const headers = {};
  const token = getToken();
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function setMessage(id, text, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#198754" : "#dc3545";
}

function initials(name) {
  if (!name) return "SC";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(x => x[0]?.toUpperCase() || "")
    .join("");
}

async function loadProfile() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "GET",
      headers: authHeaders(false)
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage("profile-message", data?.detail?.msg || "Failed to load profile", false);
      return;
    }

    document.getElementById("full_name").value = data.full_name || "";
    document.getElementById("email").value = data.email || "";
    document.getElementById("phone").value = data.phone || "";
    document.getElementById("role").value = data.role || "";
    document.getElementById("forgot_email").value = data.email || "";

    if (data.department) document.getElementById("department").value = data.department;
    if (data.license_no) document.getElementById("license_no").value = data.license_no;

    document.getElementById("account-hero-avatar").textContent = initials(data.full_name);
    const topAvatar = document.getElementById("user-avatar");
    if (topAvatar) topAvatar.textContent = initials(data.full_name);

    document.getElementById("email_notifications").checked = !!data.email_notifications;
    document.getElementById("push_notifications").checked = !!data.push_notifications;
    document.getElementById("dark_mode").checked = !!data.dark_mode;
    document.getElementById("biometric_lock").checked = !!data.biometric_lock;
  } catch (err) {
    setMessage("profile-message", "Server connection failed", false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadProfile();

  const profileForm = document.getElementById("profile-form");
  const reloadBtn = document.getElementById("reload-profile-btn");
  const prefForm = document.getElementById("preferences-form");
  const requestOtpBtn = document.getElementById("request-otp-btn");
  const passwordForm = document.getElementById("password-form");
  const forgotForm = document.getElementById("forgot-form");
  const logoutBtn = document.getElementById("logout-btn");

  profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      full_name: document.getElementById("full_name").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      department: document.getElementById("department").value.trim(),
      license_no: document.getElementById("license_no").value.trim()
    };

    try {
      const res = await fetch(`${API_BASE}/account/me`, {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage("profile-message", data?.detail?.msg || "Profile update failed", false);
        return;
      }

      setMessage("profile-message", "Profile updated successfully");
      document.getElementById("account-hero-avatar").textContent = initials(payload.full_name);
    } catch {
      setMessage("profile-message", "Server connection failed", false);
    }
  });

  reloadBtn?.addEventListener("click", loadProfile);

  prefForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      email_notifications: document.getElementById("email_notifications").checked,
      push_notifications: document.getElementById("push_notifications").checked,
      dark_mode: document.getElementById("dark_mode").checked,
      biometric_lock: document.getElementById("biometric_lock").checked
    };

    try {
      const res = await fetch(`${API_BASE}/account/preferences`, {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage("preferences-message", data?.detail?.msg || "Failed to save preferences", false);
        return;
      }

      setMessage("preferences-message", "Preferences saved successfully");
    } catch {
      setMessage("preferences-message", "Server connection failed", false);
    }
  });

  requestOtpBtn?.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/request-otp`, {
        method: "POST",
        headers: authHeaders(false)
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage("otp-message", data?.detail?.msg || "OTP request failed", false);
        return;
      }

      setMessage("otp-message", data.msg || "Verification code sent");
    } catch {
      setMessage("otp-message", "Server connection failed", false);
    }
  });

  passwordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const current_password = document.getElementById("current_password").value;
    const otp_code = document.getElementById("otp_code").value.trim();
    const new_password = document.getElementById("new_password").value;
    const confirm_password = document.getElementById("confirm_password").value;

    if (new_password !== confirm_password) {
      setMessage("password-message", "New password and confirm password do not match", false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          current_password,
          otp_code,
          new_password
        })
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.detail?.msg || (typeof data?.detail === "string" ? data.detail : "Password change failed");
        setMessage("password-message", msg, false);
        return;
      }

      setMessage("password-message", data.msg || "Password changed successfully");
      passwordForm.reset();
    } catch {
      setMessage("password-message", "Server connection failed", false);
    }
  });

  forgotForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("forgot_email").value.trim();

    try {
      const res = await fetch(`${API_BASE}/account/forgot-password`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ email })
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage("forgot-message", data?.detail?.msg || "Reset request failed", false);
        return;
      }

      setMessage("forgot-message", data.msg || "Reset request submitted");
    } catch {
      setMessage("forgot-message", "Server connection failed", false);
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/account/logout`, {
        method: "POST",
        headers: authHeaders(false)
      });
    } catch (_) {}

    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    setMessage("logout-message", "Signing out...");
    window.location.href = "/login.html";
  });
});