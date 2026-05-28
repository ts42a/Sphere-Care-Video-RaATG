const AUTH_API_BASE = (typeof API_BASE !== 'undefined' ? API_BASE.replace(/\/+$/, '') : '/api/v1');
let selectedRole = "staff";
let regStep = 1;

function setRole(role) {
  selectedRole = role;

  const staffBtn = document.getElementById("btn-staff");
  const adminBtn = document.getElementById("btn-admin");

  if (staffBtn) staffBtn.classList.toggle("active", role === "staff");
  if (adminBtn) adminBtn.classList.toggle("active", role === "admin");

  // Update step 2 panels when role changes (only matters if already on step 2)
  updateStep2Panels();
}

function updateStep2Panels() {
  const step2Staff = document.getElementById("step2-staff");
  const step2Admin = document.getElementById("step2-admin");
  if (step2Staff) step2Staff.style.display = selectedRole === "staff" ? "block" : "none";
  if (step2Admin) step2Admin.style.display = selectedRole === "admin" ? "block" : "none";
}

function updateStepIndicator(step) {
  const dot1 = document.getElementById("step-dot-1");
  const dot2 = document.getElementById("step-dot-2");
  const barFill = document.getElementById("step-bar-fill");
  if (step === 1) {
    if (dot1) dot1.style.background = "#0f1b2d";
    if (dot2) dot2.style.background = "#e2e8f0";
    if (barFill) barFill.style.width = "0%";
  } else {
    if (dot1) dot1.style.background = "#0f1b2d";
    if (dot2) dot2.style.background = "#0f1b2d";
    if (barFill) barFill.style.width = "100%";
  }
}

function nextRegStep() {
  clearError("register-error");
  const full_name = document.getElementById("reg-fullname")?.value.trim() || "";
  const email = document.getElementById("reg-email")?.value.trim() || "";
  const email_confirmation = document.getElementById("reg-email-conf")?.value.trim() || "";
  const password = document.getElementById("reg-pass")?.value || "";
  const retype_password = document.getElementById("reg-pass2")?.value || "";

  if (!full_name || !email || !email_confirmation || !password || !retype_password) {
    showError("register-error", "Please fill in all fields.");
    return;
  }
  if (email !== email_confirmation) {
    showError("register-error", "Emails do not match.");
    return;
  }
  if (password !== retype_password) {
    showError("register-error", "Passwords do not match.");
    return;
  }

  regStep = 2;
  document.getElementById("reg-step-1").style.display = "none";
  document.getElementById("reg-step-2").style.display = "block";
  updateStep2Panels();
  updateStepIndicator(2);
}

function prevRegStep() {
  regStep = 1;
  clearError("register-error-2");
  document.getElementById("reg-step-2").style.display = "none";
  document.getElementById("reg-step-1").style.display = "block";
  updateStepIndicator(1);
}

function showError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "block";
  el.textContent = message;
}

function clearError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text || "Unexpected server response" };
  }
}

async function handleRegister(event) {
  if (event) event.preventDefault();
  clearError("register-error-2");
  const successEl = document.getElementById("register-success");
  if (successEl) successEl.style.display = "none";

  const full_name = document.getElementById("reg-fullname")?.value.trim() || "";
  const email = document.getElementById("reg-email")?.value.trim() || "";
  const email_confirmation = document.getElementById("reg-email-conf")?.value.trim() || "";
  const password = document.getElementById("reg-pass")?.value || "";
  const retype_password = document.getElementById("reg-pass2")?.value || "";

  try {
    let endpoint;
    let headers = { "Content-Type": "application/json" };
    let payload = {
      full_name,
      email,
      email_confirmation,
      password,
      retype_password,
      role: selectedRole
    };

    if (selectedRole === "admin") {
      // Admin Registration (returns center_id)
      endpoint = `${AUTH_API_BASE}/auth/admin/register`;
      const orgName = document.getElementById("reg-org-name")?.value.trim();
      payload.organization_name = orgName || full_name + "'s Care Centre";
      payload.address = document.getElementById("reg-address")?.value.trim() || "";
      payload.city = document.getElementById("reg-city")?.value.trim() || "";
      payload.state = document.getElementById("reg-state")?.value.trim() || "";
      payload.postal_code = document.getElementById("reg-postal-code")?.value.trim() || "";
      payload.country = document.getElementById("reg-country")?.value.trim() || "";

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      const data = await parseJsonSafe(response);

      if (!response.ok) {
        const msg = typeof data.detail === "string" ? data.detail : data?.detail?.msg || "Admin signup failed.";
        showError("register-error-2", msg);
        return;
      }

      // Admin gets immediate access with center_id
      sessionStorage.setItem("spherecare_logged_in", "true");
      sessionStorage.setItem("spherecare_user_name", data.user?.full_name || "");
      sessionStorage.setItem("spherecare_user_email", data.user?.email || "");
      sessionStorage.setItem("spherecare_token", data.access_token || "");
      sessionStorage.setItem("spherecare_role", "admin");
      sessionStorage.setItem("spherecare_center_id", data.user?.center_id || "");

      // Store in format expected by all pages
      sessionStorage.setItem("access_token", data.access_token || "");
      sessionStorage.setItem("user", JSON.stringify(data.user || {}));

      window.location.href = "/pages/dashboard.html";
    } else {
      // Staff Registration (public endpoint, center_id required)
      const center_id = document.getElementById("reg-center-id")?.value.trim() || "";
      
      if (!center_id) {
        showError("register-error-2", "Please enter your Center ID provided by your admin.");
        return;
      }

      // Send full CTR-… / ADM-… / digits; backend resolves org via Organization or Admin unique_code
      endpoint = `${AUTH_API_BASE}/auth/staff/register?admin_id=${encodeURIComponent(center_id.trim())}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      const data = await parseJsonSafe(response);

      if (!response.ok) {
        let msg;
        if (typeof data.detail === "string") {
          msg = data.detail;
        } else if (data?.detail?.errors?.length) {
          msg = (data.detail.msg || "Registration failed") + ": " + data.detail.errors.join(", ");
        } else {
          msg = data?.detail?.msg || "Staff signup failed.";
        }
        showError("register-error-2", msg);
        return;
      }

      // Staff gets pending approval status
      if (data.token_type === "pending") {
        // Show success message with pending approval info
        const successEl = document.getElementById("register-success");
        if (successEl) {
          successEl.style.display = "block";
          successEl.textContent = `✓ Registration successful! Your admin must approve your account before you can login. You'll receive an email notification once approved.`;
        }
        
        // Store pending info for reference
        sessionStorage.setItem("spherecare_pending_email", email);
        sessionStorage.setItem("spherecare_pending_center_id", center_id);
        
        // Clear form and go back to step 1
        document.getElementById("reg-fullname").value = "";
        document.getElementById("reg-email").value = "";
        document.getElementById("reg-email-conf").value = "";
        document.getElementById("reg-pass").value = "";
        document.getElementById("reg-pass2").value = "";
        document.getElementById("reg-center-id").value = "";

        // After 6 seconds, redirect to login
        setTimeout(() => {
          prevRegStep();
          showPage("login");
        }, 6000);
      }
    }
  } catch (error) {
    console.error(error);
    showError("register-error-2", "Could not connect to server.");
  }
}

async function handleLogin(event) {
  if (event) event.preventDefault();
  clearError("login-error");

  const email = document.getElementById("login-email")?.value.trim() || "";
  const password = document.getElementById("login-pass")?.value || "";
  const center_id = document.getElementById("login-center-id")?.value.trim() || "";

  if (!email || !password) {
    showError("login-error", "Please enter email and password.");
    return;
  }

  try {
    let url = `${AUTH_API_BASE}/auth/login`;
    const payload = { email, password };

    if (center_id) {
      url = `${AUTH_API_BASE}/auth/login?admin_id=${encodeURIComponent(center_id.trim())}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      const approvalStatus = data?.detail?.approval_status;
      const detailMsg = typeof data.detail === "string" ? data.detail : data?.detail?.msg || "";

      if (response.status === 403 && approvalStatus === "pending") {
        showError("login-error", "Your account is pending approval from your admin. Please check your email for updates.");
      } else if (response.status === 403 && approvalStatus === "rejected") {
        showError("login-error", "Your account has been rejected. Please contact your admin.");
      } else if (response.status === 403 && detailMsg.toLowerCase().includes("pending")) {
        showError("login-error", "Your account is pending approval from your admin. Please check your email for updates.");
      } else if (response.status === 403 && detailMsg.toLowerCase().includes("rejected")) {
        showError("login-error", "Your account has been rejected. Please contact your admin.");
      } else {
        const msg = detailMsg || "Login failed.";
        showError("login-error", msg);
      }
      return;
    }

    sessionStorage.setItem("spherecare_logged_in", "true");
    sessionStorage.setItem("spherecare_user_name", data.user?.full_name || "");
    sessionStorage.setItem("spherecare_user_email", data.user?.email || "");
    sessionStorage.setItem("spherecare_token", data.access_token || "");
    sessionStorage.setItem("spherecare_role", data.user?.role || "staff");

    // Store in format expected by all pages
    sessionStorage.setItem("access_token", data.access_token || "");
    sessionStorage.setItem("user", JSON.stringify(data.user || {}));
    
    // Store center_id for staff
    if (center_id) {
      sessionStorage.setItem("spherecare_center_id", center_id);
    } else if (data.admin_id) {
      sessionStorage.setItem("spherecare_admin_id", data.admin_id || "");
    }

    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("return");
    if (returnTo && returnTo.startsWith("/pages/")) {
      window.location.href = returnTo;
    } else {
      window.location.href = "/pages/dashboard.html";
    }
  } catch (error) {
    console.error(error);
    showError("login-error", "Could not connect to server.");
  }
}

window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.setRole = setRole;
window.nextRegStep = nextRegStep;
window.prevRegStep = prevRegStep;

// Show/Hide different pages
function showPage(pageId) {
  const pages = document.querySelectorAll(".page");
  pages.forEach(p => p.classList.remove("active"));
  
  const activePage = document.getElementById(`page-${pageId}`);
  if (activePage) {
    activePage.classList.add("active");
  }
}

// Toggle login center_id field (for staff staff login selection)
function toggleLoginCenterId(showCenterId) {
  const centerIdGroup = document.getElementById("login-center-id-group");
  if (centerIdGroup) {
    centerIdGroup.style.display = showCenterId ? "flex" : "none";
  }
}

window.showPage = showPage;
window.toggleLoginCenterId = toggleLoginCenterId;

function initializeAuthPage() {
  // Default registration role
  setRole('staff');

  // Center ID is no longer needed for login – backend searches all admin DBs
  toggleLoginCenterId(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeAuthPage);
} else {
  initializeAuthPage();
}