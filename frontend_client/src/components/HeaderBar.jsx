import { useNavigate } from "react-router-dom";
import bellIcon from "../assets/icons/bell.svg";
import settingsIcon from "../assets/icons/settings.svg";
import profileIcon from "../assets/icons/profile.svg";
import backIcon from "../assets/icons/back.svg";

export default function HeaderBar({ userName, title, showBack = false }) {
  const navigate = useNavigate();

  return (
    <div className="header-bar">
      <div className="header-user">
        {showBack ? (
          <>
            <button className="back-icon" onClick={() => navigate(-1)} aria-label="Go back">
              <img src={backIcon} alt="Back" className="back-icon-img" />
            </button>
            <span className="header-page-title">{title}</span>
          </>
        ) : (
          <>
            <img src={profileIcon} alt="Profile" className="header-profile-icon" />
            <span className="type-h3">Hi {userName}</span>
          </>
        )}
      </div>

      <div className="header-actions">
        <button className="icon-btn" aria-label="Notifications">
          <img src={bellIcon} alt="Notifications" className="header-icon-img" />
        </button>
        <button className="icon-btn" aria-label="Settings">
          <img src={settingsIcon} alt="Settings" className="header-icon-img" />
        </button>
      </div>
    </div>
  );
}