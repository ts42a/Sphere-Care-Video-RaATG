import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import HeaderBar from "../../components/HeaderBar";
import BottomNav from "../../components/BottomNav";
import { callContacts } from "../../mock/callData";
import redCallIcon from "../../assets/icons/call-red.svg";
import { FaPhone } from "react-icons/fa6";
import { MdMessage } from "react-icons/md";
import { FaVideo } from "react-icons/fa6";

export default function CallCenter() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const filteredContacts = useMemo(() => {
    return callContacts.filter((item) =>
      item.name.toLowerCase().includes(query.toLowerCase())
    );
  }, [query]);

  return (
    <div className="mobile-shell">
      <div className="call-screen">
        <HeaderBar title="Call Center" showBack />

        <div className="call-summary-card">
          <div className="call-summary-top">
            <div>
              <h2 className="type-h2">Recent Activity</h2>
              <p className="type-body-md">You have three pending calls today</p>
            </div>
            <div className="call-summary-illustration">
                <img src={redCallIcon} alt="RedPhone" className="call-summary-illustration-img" />
            </div>
          </div>

          <div className="call-summary-stats">
            <div className="call-stat-box">
              <span className="type-body-md">Today</span>
              <strong className="type-h4">6 calls</strong>
            </div>
            <div className="call-stat-box">
              <span className="type-body-md">Missed</span>
              <strong className="type-h4">6 calls</strong>
            </div>
            <div className="call-stat-box">
              <span className="type-body-md">Duration</span>
              <strong className="type-h4">6 calls</strong>
            </div>
          </div>
        </div>

        <div className="call-search-row">
          <input
            className="call-search-input type-body-md"
            placeholder="Search by name, ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="call-add-btn">+</button>
        </div>

        <div className="call-contact-list">
          {filteredContacts.map((contact) => (
            <div key={contact.id} className="call-contact-card">
              <div className={`call-contact-avatar ${contact.color}`}>
                {contact.initials}
              </div>

              <div className="call-contact-info">
                <h3 className="type-h4">{contact.name}</h3>
                <p className="type-body-sm">{contact.lastSeen}</p>
              </div>

              <div className="call-contact-actions">
                <button onClick={() => navigate(`/call/audio/${contact.id}`)}><FaPhone /></button>
                <button onClick={() => navigate(`/messages/${contact.id}`)}><MdMessage /></button>
                <button onClick={() => navigate(`/call/video/${contact.id}`)}><FaVideo /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
