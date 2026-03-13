import { useNavigate } from "react-router-dom";

export default function ResetSuccessPage() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell auth-shell">
      <div className="auth-screen auth-top-layout">
        <button className="auth-circle-back" onClick={() => navigate("/set-password")}>
          ←
        </button>

        <h1 className="type-h2 auth-page-title">Password reset</h1>
        <p className="type-body-lg auth-page-desc">
          Your password has been successfully reset. click
          <br />
          confirm to set a new password
        </p>

        <button
          className="auth-primary-btn type-h4 auth-wide-btn"
          onClick={() => navigate("/login")}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}