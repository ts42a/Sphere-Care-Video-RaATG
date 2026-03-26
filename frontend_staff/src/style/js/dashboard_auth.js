const DASHBOARD_API_BASE = '/api/v1';

function getActiveToken() {
  return sessionStorage.getItem('access_token') || sessionStorage.getItem('spherecare_token');
}

function syncActiveToken(token) {
  if (!token) return;
  sessionStorage.setItem('access_token', token);
  sessionStorage.setItem('spherecare_token', token);
}

function applyStoredUserFallback() {
  try {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (!user || !Object.keys(user).length) return false;

    const nameEl = document.getElementById('current-user-name');
    const emailEl = document.getElementById('current-user-email');
    const roleEl = document.getElementById('current-user-role');

    if (nameEl) nameEl.textContent = user.full_name || 'User';
    if (emailEl) emailEl.textContent = user.email || '';
    if (roleEl) roleEl.textContent = user.role || user.global_role || 'staff';
    return true;
  } catch (_) {
    return false;
  }
}

async function loadCurrentUser() {
  const token = getActiveToken();

  if (!token) {
    window.location.href = "/pages/register-login.html";
    return;
  }

  syncActiveToken(token);

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
      if (applyStoredUserFallback()) {
        console.warn('auth/me failed, using stored user fallback');
        return;
      }
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("spherecare_token");
      sessionStorage.removeItem("user");
      window.location.href = "/pages/register-login.html";
      return;
    }

    const user = data.user || data;
    // Normalise: backend returns global_role, frontend expects role
    user.role = user.role || user.global_role || 'staff';

    // Update stored user info
    sessionStorage.setItem("user", JSON.stringify(user));

    const nameEl = document.getElementById("current-user-name");
    const emailEl = document.getElementById("current-user-email");
    const roleEl = document.getElementById("current-user-role");

    if (nameEl) nameEl.textContent = user.full_name || "User";
    if (emailEl) emailEl.textContent = user.email || "";
    if (roleEl) roleEl.textContent = user.role || "staff";
  } catch (error) {
    console.error(error);
    if (applyStoredUserFallback()) {
      console.warn('auth/me request failed, using stored user fallback');
      return;
    }
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("spherecare_token");
    sessionStorage.removeItem("user");
    window.location.href = "/pages/register-login.html";
  }
}

function logoutUser() {
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("spherecare_token");
  sessionStorage.removeItem("user");
  window.location.href = "/pages/register-login.html";
}

window.addEventListener("DOMContentLoaded", loadCurrentUser);
window.logoutUser = logoutUser;