import homeIcon from "../assets/icons/bar-home.svg";
import callIcon from "../assets/icons/bar-call.svg";
import bookingIcon from "../assets/icons/bar-booking.svg";
import taskIcon from "../assets/icons/bar-task.svg";
import messageIcon from "../assets/icons/bar-messages.svg";

export default function BottomNav() {
  return (
    <div className="bottom-nav-wrap">
      <div className="bottom-nav">
        <div className="nav-item active">
          <img src={homeIcon} alt="Home" className="nav-icon-img active-icon" />
          <span className="nav-dot"></span>
        </div>

        <div className="nav-item">
          <img src={callIcon} alt="Call" className="nav-icon-img" />
        </div>

        <div className="nav-item">
          <img src={bookingIcon} alt="Booking" className="nav-icon-img" />
        </div>

        <div className="nav-item">
          <img src={taskIcon} alt="Tasks" className="nav-icon-img" />
        </div>

        <div className="nav-item">
          <img src={messageIcon} alt="Messages" className="nav-icon-img" />
        </div>
      </div>

      <div className="home-indicator"></div>
    </div>
  );
}