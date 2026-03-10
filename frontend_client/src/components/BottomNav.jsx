import { useLocation, useNavigate } from "react-router-dom";
import homeIcon from "../assets/icons/bar-home.svg";
import phoneIcon from "../assets/icons/bar-call.svg";
import calendarIcon from "../assets/icons/bar-booking.svg";
import documentIcon from "../assets/icons/bar-task.svg";
import messageIcon from "../assets/icons/bar-messages.svg";

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isHome = location.pathname === "/home";
  const isCall = location.pathname.startsWith("/call");
  const isBooking = location.pathname.startsWith("/booking");
  const isTask = location.pathname.startsWith("/tasks");
  const isMessages = location.pathname.startsWith("/messages");

  return (
    <div className="bottom-nav-wrap">
      <div className="bottom-nav">
        <div className={`nav-item ${isHome ? "active" : ""}`} onClick={() => navigate("/home")}>
          <img src={homeIcon} alt="Home" className="nav-icon-img" />
          {isHome && <span className="nav-dot"></span>}
        </div>

        <div className={`nav-item ${isCall ? "active" : ""}`} onClick={() => navigate("/call")}>
          <img src={phoneIcon} alt="Call" className="nav-icon-img" />
          {isCall && <span className="nav-dot"></span>}
        </div>

        <div className={`nav-item ${isBooking ? "active" : ""}`} onClick={() => navigate("/booking")}>
          <img src={calendarIcon} alt="Booking" className="nav-icon-img" />
          {isBooking && <span className="nav-dot"></span>}
        </div>

        <div className={`nav-item ${isTask ? "active" : ""}`} onClick={() => navigate("/tasks")}>
          <img src={documentIcon} alt="Task" className="nav-icon-img" />
          {isTask && <span className="nav-dot"></span>}
        </div>

        <div className={`nav-item ${isMessages ? "active" : ""}`} onClick={() => navigate("/messages")}>
          <img src={messageIcon} alt="Messages" className="nav-icon-img" />
          {isMessages && <span className="nav-dot"></span>}
        </div>
      </div>

      <div className="home-indicator"></div>
    </div>
  );
}