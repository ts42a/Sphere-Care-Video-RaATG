const AUTH_API_BASE = (typeof API_BASE !== 'undefined' ? API_BASE.replace(/\/+$/, '') : '/api/v1');
let selectedRole = "staff";

function setRole(role) {
  selectedRole = role;

  const staffBtn = document.getElementById("btn-staff");
  const adminBtn = document.getElementById("btn-admin");

  if (staffBtn) staffBtn.classList.toggle("active", role === "staff");
  if (adminBtn) adminBtn.classList.toggle("active", role === "admin");

  // Show/hide org name field based on role (admin only)
  const orgNameGroup = document.getElementById("org-name-group");
  if (orgNameGroup) {
    orgNameGroup.style.display = role === "admin" ? "flex" : "none";
  }

  // Show/hide center ID field based on role (staff only)
  const centerIdGroup = document.getElementById("center-id-group");
  if (centerIdGroup) {
    centerIdGroup.style.display = role === "staff" ? "flex" : "none";
  }
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
  clearError("register-error");
  const successEl = document.getElementById("register-success");
  if (successEl) successEl.style.display = "none";

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

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      const data = await parseJsonSafe(response);

      if (!response.ok) {
        const msg = typeof data.detail === "string" ? data.detail : data?.detail?.msg || "Admin signup failed.";
        showError("register-error", msg);
        return;
      }

      // Admin gets immediate access with center_id
      localStorage.setItem("spherecare_logged_in", "true");
      localStorage.setItem("spherecare_user_name", data.user?.full_name || "");
      localStorage.setItem("spherecare_user_email", data.user?.email || "");
      localStorage.setItem("spherecare_token", data.access_token || "");
      localStorage.setItem("spherecare_role", "admin");
      localStorage.setItem("spherecare_center_id", data.user?.center_id || "");

      // Store in format expected by all pages
      localStorage.setItem("access_token", data.access_token || "");
      localStorage.setItem("user", JSON.stringify(data.user || {}));

      window.location.href = "/pages/dashboard.html";
    } else {
      // Staff Registration (public endpoint, center_id required)
      const center_id = document.getElementById("reg-center-id")?.value.trim() || "";
      
      if (!center_id) {
        showError("register-error", "Please enter your Center ID provided by your admin.");
        return;
      }

      endpoint = `${AUTH_API_BASE}/auth/staff/register`;
      payload.admin_id = center_id;

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      const data = await parseJsonSafe(response);

      if (!response.ok) {
        const msg = typeof data.detail === "string" ? data.detail : data?.detail?.msg || "Staff signup failed.";
        showError("register-error", msg);
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
        localStorage.setItem("spherecare_pending_email", email);
        localStorage.setItem("spherecare_pending_center_id", center_id);
        
        // Clear form
        document.getElementById("reg-fullname").value = "";
        document.getElementById("reg-email").value = "";
        document.getElementById("reg-email-conf").value = "";
        document.getElementById("reg-pass").value = "";
        document.getElementById("reg-pass2").value = "";
        document.getElementById("reg-center-id").value = "";

        // After 3 seconds, redirect to login
        setTimeout(() => {
          showPage("login");
        }, 6000);
      }
    }
  } catch (error) {
    console.error(error);
    showError("register-error", "Could not connect to server.");
  }
}

async function handleLogin(event) {
  if (event) event.preventDefault();
  clearError("login-error");

  const email = document.getElementById("login-email")?.value.trim() || "";
  const password = document.getElementById("login-pass")?.value || "";
  const center_id = document.getElementById("login-center-id")?.value.trim() || "";

  console.log("Email:", email, "Has Center ID:", !!center_id);

  if (!email || !password) {
    showError("login-error", "Please enter email and password.");
    return;
  }

  try {
    const url = `${AUTH_API_BASE}/auth/login`;
    const payload = { email, password };
    
    // Add center_id if provided (for staff login)
    if (center_id) {
      payload.admin_id = center_id;
    }

    console.log("Fetching:", url, "with payload:", payload);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      if (response.status === 403 && data.detail && data.detail.includes("not approved")) {
        showError("login-error", "Your account is pending approval from your admin. Please check your email for updates.");
      } else if (response.status === 403 && data.detail && data.detail.includes("rejected")) {
        showError("login-error", "Your account has been rejected. Please contact your admin.");
      } else {
        const msg = typeof data.detail === "string" ? data.detail : data?.detail?.msg || "Login failed.";
        showError("login-error", msg);
      }
      return;
    }

    localStorage.setItem("spherecare_logged_in", "true");
    localStorage.setItem("spherecare_user_name", data.user?.full_name || "");
    localStorage.setItem("spherecare_user_email", data.user?.email || "");
    localStorage.setItem("spherecare_token", data.access_token || "");
    localStorage.setItem("spherecare_role", data.user?.role || "staff");

    // Store in format expected by all pages
    localStorage.setItem("access_token", data.access_token || "");
    localStorage.setItem("user", JSON.stringify(data.user || {}));
    
    // Store center_id for staff
    if (center_id) {
      localStorage.setItem("spherecare_center_id", center_id);
    } else if (data.admin_id) {
      localStorage.setItem("spherecare_admin_id", data.admin_id || "");
    }

    // Redirect to dashboard
    window.location.href = "/pages/dashboard.html";
  } catch (error) {
    console.error(error);
    showError("login-error", "Could not connect to server.");
  }
}

window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.setRole = setRole;

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