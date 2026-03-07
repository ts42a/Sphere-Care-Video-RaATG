import bellIcon from "../assets/icons/bell.svg";
import settingsIcon from "../assets/icons/settings.svg";
import userIcon from "../assets/icons/userIcon.svg";

export default function HeaderBar({ userName }) {
  return (
    <div className="header-bar">
      <div className="header-user">
        <img src={userIcon} alt="Profile" className="header-profile-icon" />
        <span className="header-greeting">Hi {userName}</span>
      </div>

      <div className="header-actions">
        <button className="icon-btn bell-btn" aria-label="Notifications">
          <img src={bellIcon} alt="Notifications" className="header-icon-img" />
        </button>
        <button className="icon-btn gear-btn" aria-label="Settings">
          <img src={settingsIcon} alt="Settings" className="header-icon-img" />
        </button>
      </div>
    </div>
  );
}