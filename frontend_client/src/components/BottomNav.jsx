import homeIcon from "../assets/icons/bar-home.svg";
import callIcon from "../assets/icons/bar-call.svg";
import bookingIcon from "../assets/icons/bar-booking.svg";
import taskIcon from "../assets/icons/bar-task.svg";
import messagesIcon from "../assets/icons/bar-messages.svg";
import { useLocation, useNavigate } from "react-router-dom";

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isHome = location.pathname === "/home";
  const isBooking = location.pathname.startsWith("/booking");
  const isCall = location.pathname.startsWith("/call");
  const isMessages = location.pathname.startsWith("/messages");
  
  return (
    <div className="bottom-nav-wrap">
      <div className="bottom-nav">
        <div className={`nav-item ${isHome ? "active" : ""}`} onClick={() => navigate("/home")}>
          <img src={homeIcon} alt="Home" className="nav-icon-img" />
          {isHome && <span className="nav-dot"></span>}
        </div>

        <div className={`nav-item ${isCall ? "active" : ""}`} onClick={() => navigate("/call")}>
          <img src={callIcon} alt="Call" className="nav-icon-img" />
          {isCall && <span className="nav-dot"></span>}
        </div>

        <div className={`nav-item ${isBooking ? "active" : ""}`} onClick={() => navigate("/booking")}>
          <img src={bookingIcon} alt="Booking" className="nav-icon-img" />
          {isBooking && <span className="nav-dot"></span>}
        </div>

        <div className="nav-item">
          <img src={taskIcon} alt="Tasks" className="nav-icon-img" />
        </div>

        <div className={`nav-item ${isMessages ? "active" : ""}`}>
          <img src={messagesIcon} alt="Messages" className="nav-icon-img" />
          {isMessages && <span className="nav-dot"></span>}
        </div>
      </div>

      <div className="home-indicator"></div>
    </div>
  );
}