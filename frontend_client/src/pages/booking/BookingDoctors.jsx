import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import HeaderBar from "../../components/HeaderBar";
import BottomNav from "../../components/BottomNav";

const doctors = [
  { id: "jack-specs", name: "Dr. Jack Specs", specialty: "General Practitioner", available: true },
  { id: "emily-ross", name: "Dr. Emily Ross", specialty: "General Practitioner", available: false },
  { id: "michael-chen", name: "Dr. Michael Chen", specialty: "General Practitioner", available: true },
  { id: "helen-cruz", name: "Dr. Helen Cruz", specialty: "General Practitioner", available: false },
  { id: "robert-kim", name: "Dr. Robert Kim", specialty: "General Practitioner", available: true },
];

function formatAppointmentType(type) {
  return type
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export default function BookingDoctors() {
  const navigate = useNavigate();
  const { appointmentType } = useParams();
  const [filter, setFilter] = useState("all");

  const filteredDoctors = useMemo(() => {
    if (filter === "available") return doctors.filter((doctor) => doctor.available);
    if (filter === "unavailable") return doctors.filter((doctor) => !doctor.available);
    return doctors;
  }, [filter]);

  return (
    <div className="mobile-shell">
      <div className="booking-screen">
        <HeaderBar title="Booking" showBack />

        <div className="doctor-page-header">

          <div className="doctor-page-title-wrap">
            <h2 className="type-h2">Select a Doctor</h2>
            <p className="type-body-md">
              Showing available doctors for {formatAppointmentType(appointmentType)}
            </p>
          </div>

          <div className="booking-page-icon">?</div>
        </div>

        <div className="filter-tabs">
          <button
            className={`filter-tab type-label ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>

          <button
            className={`filter-tab type-label ${filter === "available" ? "active" : ""}`}
            onClick={() => setFilter("available")}
          >
            Available
          </button>

          <button
            className={`filter-tab type-label ${filter === "unavailable" ? "active" : ""}`}
            onClick={() => setFilter("unavailable")}
          >
            Unavailable
          </button>
        </div>

        <div className="doctor-list">
          {filteredDoctors.map((doctor) => (
            <div className="doctor-card" key={doctor.id}>
              <div className={`doctor-avatar ${doctor.available ? "available" : "unavailable"}`}></div>

              <div className="doctor-info">
                <h3 className="type-h4">{doctor.name}</h3>
                <p className="type-body-md">{doctor.specialty}</p>
                <span className={`doctor-status type-body-md ${doctor.available ? "available" : "unavailable"}`}>
                  {doctor.available ? "● Available now" : "● Unavailable"}
                </span>
              </div>

              <button
                className={`doctor-book-btn type-h4 ${doctor.available ? "" : "disabled"}`}
                disabled={!doctor.available}
                onClick={() =>
                  doctor.available &&
                  navigate(`/booking/schedule/${appointmentType}/${doctor.id}`)
                }
              >
                Book
              </button>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}