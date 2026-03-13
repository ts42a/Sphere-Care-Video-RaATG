import { useNavigate } from "react-router-dom";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell auth-shell">
      <div className="auth-screen auth-top-layout">
        <button className="auth-circle-back" onClick={() => navigate("/login")}>
          ←
        </button>

        <h1 className="type-h2 auth-page-title">Forgot password</h1>
        <p className="type-body-lg auth-page-desc">
          Please enter your email to reset the password
        </p>

        <label className="type-h4 auth-label">Your Email</label>

        <input
          className="auth-input type-body-lg"
          type="email"
          placeholder="contact@dscodetech.com"
        />

        <button
          className="auth-primary-btn type-h4 auth-wide-btn"
          onClick={() => navigate("/forgot-password/verify")}
        >
          Reset Password
        </button>
      </div>
    </div>
  );
}