import { useNavigate } from "react-router-dom";

export default function VerifyCodePage() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell auth-shell">
      <div className="auth-screen auth-top-layout">
        <button className="auth-circle-back" onClick={() => navigate("/forgot-password")}>
          ←
        </button>

        <h1 className="type-h2 auth-page-title">Check your email</h1>
        <p className="type-body-lg auth-page-desc">
          We sent a reset link to <strong>contact@dscode...com</strong>
          <br />
          enter 5 digit code that mentioned in the email
        </p>

        <div className="auth-code-row">
          <input className="auth-code-box type-h3 active" maxLength="1" defaultValue="8" />
          <input className="auth-code-box type-h3 active" maxLength="1" defaultValue="6" />
          <input className="auth-code-box type-h3 active" maxLength="1" defaultValue="3" />
          <input className="auth-code-box type-h3" maxLength="1" />
          <input className="auth-code-box type-h3" maxLength="1" />
        </div>

        <button
          className="auth-primary-btn type-h4 auth-wide-btn"
          onClick={() => navigate("/set-password")}
        >
          Verify Code
        </button>

        <p className="type-body-lg auth-resend-text">
          Haven’t got the email yet?{" "}
          <button className="auth-inline-link type-body-lg">Resend email</button>
        </p>
      </div>
    </div>
  );
}