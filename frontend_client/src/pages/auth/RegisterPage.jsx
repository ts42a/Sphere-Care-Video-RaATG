import { useNavigate } from "react-router-dom";
import { FcGoogle } from "react-icons/fc";

export default function RegisterPage() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell auth-shell">
      <div className="auth-screen auth-center-layout">
        <div className="auth-logo-wrap">
          <div className="auth-logo-box">🖼</div>
          <div className="type-h3 auth-logo-text">LOGO</div>
        </div>

        <h1 className="type-h1 auth-title">Register</h1>
        <p className="type-h4 auth-subtitle">Enter your details to register</p>

        <div className="auth-form">
          <input
            className="auth-input type-body-lg"
            type="email"
            placeholder="johnsmith@gmail.com"
          />

          <div className="auth-phone-row">
            <div className="auth-country-code type-body-lg">🇦🇺 ▾</div>
            <input
              className="auth-phone-input type-body-lg"
              type="text"
              placeholder="04123456789"
            />
          </div>

          <input
            className="auth-input type-body-lg"
            type="password"
            placeholder="XXXXXXXX"
          />

          <input
            className="auth-input type-body-lg"
            type="password"
            placeholder="XXXXXXXX"
          />

          <button className="auth-primary-btn type-h4" onClick={() => navigate("/home")}>
            Register
          </button>
        </div>

        <p className="type-body-lg auth-bottom-text left-align">
          already have account continue
          <br />
          with log in
        </p>

        <p className="type-body-lg auth-divider-text">Or register with</p>

        <div className="auth-social-row">
          <button className="auth-social-btn google type-h4"><FcGoogle /> Google</button>
          <button className="auth-social-btn facebook type-h4">Facebook</button>
        </div>
      </div>
    </div>
  );
}