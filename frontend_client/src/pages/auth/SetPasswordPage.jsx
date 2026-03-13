import { useNavigate } from "react-router-dom";

export default function SetPasswordPage() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell auth-shell">
      <div className="auth-screen auth-top-layout">
        <button className="auth-circle-back" onClick={() => navigate("/forgot-password/verify")}>
          ←
        </button>

        <h1 className="type-h2 auth-page-title">Set a new password</h1>
        <p className="type-body-lg auth-page-desc">
          Create a new password. Ensure it differs from
          <br />
          previous ones for security
        </p>

        <label className="type-h4 auth-label">Password</label>
        <div className="auth-password-wrap">
          <input
            className="auth-input type-body-lg auth-password-input"
            type="password"
            placeholder="•••••••••••"
          />
          <span className="auth-eye-icon">◌</span>
        </div>

        <label className="type-h4 auth-label">Confirm Password</label>
        <div className="auth-password-wrap">
          <input
            className="auth-input type-body-lg auth-password-input"
            type="password"
            placeholder="•••••••••••"
          />
          <span className="auth-eye-icon">◌</span>
        </div>

        <button
          className="auth-primary-btn type-h4 auth-wide-btn"
          onClick={() => navigate("/password-reset-success")}
        >
          Update Password
        </button>
      </div>
    </div>
  );
}