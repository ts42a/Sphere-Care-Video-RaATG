import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import HeaderBar from "../../components/HeaderBar";
import BottomNav from "../../components/BottomNav";

const doctors = {
  "jack-specs": {
    name: "Dr. Jack Specs",
    specialty: "Cardiologist",
    price: "$130/h",
    rating: "4.6",
    experience: "12 years exp",
    dateLabel: "Nov 15",
  },
  "michael-chen": {
    name: "Dr. Michael Chen",
    specialty: "General Practitioner",
    price: "$110/h",
    rating: "4.8",
    experience: "10 years exp",
    dateLabel: "Nov 15",
  },
  "robert-kim": {
    name: "Dr. Robert Kim",
    specialty: "General Practitioner",
    price: "$120/h",
    rating: "4.7",
    experience: "11 years exp",
    dateLabel: "Nov 15",
  },
};

const days = ["Sun", "Mon", "Tue", "Wes", "Thu", "Fri", "Sat"];
const dateNumbers = ["", "", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31"];
const times = ["9:00 AM", "9:30 AM", "10:30 AM", "11:00 AM"];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { doctorId } = useParams();
  const [selectedDate, setSelectedDate] = useState("23");
  const [selectedTime, setSelectedTime] = useState("11:00 AM");

  const doctor = useMemo(() => doctors[doctorId] || doctors["jack-specs"], [doctorId]);

  return (
    <div className="mobile-shell">
      <div className="booking-screen">
        <HeaderBar title="Booking" showBack />

        <div className="doctor-summary-card">
          <div className="doctor-summary-avatar"></div>

          <div className="doctor-summary-info">
            <h3 className="type-h4">{doctor.name}</h3>
            <p className="type-body-md">{doctor.specialty}</p>
            <span className="type-body-md">{doctor.price}</span>
          </div>

          <div className="doctor-summary-meta">
            <span className="doctor-summary-date">{doctor.dateLabel}</span>
            <p className="type-body-xs">icon {doctor.rating}</p>
            <p className="type-body-xs">icon {doctor.experience}</p>
          </div>
        </div>

        <div className="calendar-header">
          <button className="calendar-arrow">‹</button>
          <h2 className="type-h2">October 2025</h2>
          <button className="calendar-arrow">›</button>
        </div>

        <div className="calendar-grid">
          {days.map((day) => (
            <div key={day} className="calendar-day-label type-body-md">{day}</div>
          ))}

          {dateNumbers.map((date, index) => (
            <button
              key={`${date}-${index}`}
              className={`calendar-date type-body-lg ${selectedDate === date ? "selected" : ""} ${date === "" ? "empty" : ""}`}
              onClick={() => date && setSelectedDate(date)}
              disabled={date === ""}
            >
              {date}
            </button>
          ))}
        </div>

        <div className="time-section">
          <div className="time-section-title type-h3">Available Times</div>

          <div className="time-grid">
            {times.map((time) => (
              <button
                key={time}
                className={`time-slot type-h4 ${selectedTime === time ? "selected" : ""}`}
                onClick={() => setSelectedTime(time)}
              >
                {time}
              </button>
            ))}
          </div>
        </div>

        <div className="schedule-actions">
          <button className="schedule-back-btn type-h4" onClick={() => navigate(-1)}>
            ← Back
          </button>

          <button
            className="schedule-next-btn type-h4"
            disabled={!selectedDate || !selectedTime}
          >
            Next →
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}