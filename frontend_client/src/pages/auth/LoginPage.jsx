import { useNavigate } from "react-router-dom";
import { FcGoogle } from "react-icons/fc";

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell auth-shell">
      <div className="auth-screen auth-center-layout">
        <div className="auth-logo-wrap">
          <div className="auth-logo-box">🖼</div>
          <div className="type-h3 auth-logo-text">LOGO</div>
        </div>

        <h1 className="type-h1 auth-title">Login</h1>
        <p className="type-h4 auth-subtitle">
          Enter your email and password
          <br />
          to login
        </p>

        <div className="auth-form">
          <input
            className="auth-input type-body-lg"
            type="email"
            placeholder="johnsmith@gmail.com"
          />

          <input
            className="auth-input type-body-lg"
            type="password"
            placeholder="XXXXXXXXXXX"
          />

          <button
            className="auth-link-btn type-body-lg auth-forgot-link"
            onClick={() => navigate("/forgot-password")}
          >
            Forgot Password?
          </button>

          <button className="auth-primary-btn type-h4" onClick={() => navigate("/home")}>
            Login
          </button>
        </div>

        <p className="type-body-lg auth-divider-text">Or login in with</p>

        <div className="auth-social-row">
          <button className="auth-social-btn google type-h4"><FcGoogle />Google</button>
          <button className="auth-social-btn facebook type-h4">Facebook</button>
        </div>

        <p className="type-body-lg auth-bottom-text">
          Don't have an account?{" "}
          <button className="auth-inline-link type-h4" onClick={() => navigate("/register")}>
            Register
          </button>
        </p>
      </div>
    </div>
  );
}