const DASHBOARD_API_BASE = '/api/v1';

async function loadCurrentUser() {
  const token = localStorage.getItem("spherecare_token");
  const loggedIn = localStorage.getItem("spherecare_logged_in") === "true";

  if (!token || !loggedIn) {
    window.location.href = "/pages/register-login.html";
    return;
  }

  try {
    const response = await fetch(`${DASHBOARD_API_BASE}/auth/me`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      localStorage.clear();
      window.location.href = "/pages/register-login.html";
      return;
    }

    const user = data.user || data;

    const nameEl = document.getElementById("current-user-name");
    const emailEl = document.getElementById("current-user-email");
    const roleEl = document.getElementById("current-user-role");

    if (nameEl) nameEl.textContent = user.full_name || localStorage.getItem("spherecare_user_name") || "User";
    if (emailEl) emailEl.textContent = user.email || localStorage.getItem("spherecare_user_email") || "";
    if (roleEl) roleEl.textContent = user.role || localStorage.getItem("spherecare_role") || "staff";
  } catch (error) {
    console.error(error);
    localStorage.clear();
    window.location.href = "/pages/register-login.html";
  }
}

function logoutUser() {
  localStorage.removeItem("spherecare_logged_in");
  localStorage.removeItem("spherecare_user_email");
  localStorage.removeItem("spherecare_user_name");
  localStorage.removeItem("spherecare_token");
  localStorage.removeItem("spherecare_role");
  window.location.href = "/pages/register-login.html";
}

window.addEventListener("DOMContentLoaded", loadCurrentUser);
window.logoutUser = logoutUser;