import { useNavigate } from "react-router-dom";
import HeaderBar from "../../components/HeaderBar";
import BottomNav from "../../components/BottomNav";

const bookingTypes = [
  { id: "general-check-up", title: "General Check up", duration: "30 min" },
  { id: "follow-up-visit", title: "Follow up Visit", duration: "30 min" },
  { id: "consultation-check-up", title: "Consultation Check up", duration: "30 min" },
  { id: "lab-test", title: "LAB Test", duration: "30 min" },
  { id: "review-med", title: "Review Med", duration: "30 min" },
  { id: "vaccination", title: "Vaccination", duration: "30 min" },
];

export default function BookingHome() {
  const navigate = useNavigate();

  return (
    <div className="mobile-shell">
      <div className="booking-screen">
        <HeaderBar title="Booking" showBack />

        <div className="booking-intro-card">
          <h2 className="type-h2">What brings you in today?</h2>
          <p className="type-body-md">Select the type of appointment you need</p>
        </div>

        <div className="booking-type-grid">
          {bookingTypes.map((item) => (
            <button
              key={item.id}
              className="booking-type-card"
              onClick={() => navigate(`/booking/doctors/${item.id}`)}
            >
              <div className="booking-type-icon">?</div>
              <h3 className="type-h4">{item.title}</h3>
              <p className="type-body-md">{item.duration}</p>
            </button>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}