import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../../components/BottomNav";
import { FaArrowLeft } from "react-icons/fa";

const messageListData = [
  {
    id: "sarah-wilson",
    initials: "SW",
    name: "Dr. Sarah Wilson",
    role: "Cardiologist",
    preview: "Patient vitals look stable...",
    time: "2 min ago",
    unread: 2,
    online: true,
    color: "blue",
  },
  {
    id: "emily-rodriguez",
    initials: "ER",
    name: "Emily Rodriguez",
    role: "Nurse Supervisor",
    preview: "Thanks for the update on room 204...",
    time: "15 min ago",
    unread: 0,
    online: false,
    color: "purple",
  },
  {
    id: "family-johnson",
    initials: "FJ",
    name: "Family – Johnson",
    role: "",
    preview: "We'll be visiting tomorrow morning...",
    time: "1 h ago",
    unread: 0,
    online: false,
    color: "green",
  },
  {
    id: "michael-chen",
    initials: "MC",
    name: "Dr. Michael Chen",
    role: "",
    preview: "Lab results are ready for review...",
    time: "2 h ago",
    unread: 1,
    online: false,
    color: "orange",
  },
  {
    id: "care-team",
    initials: "CT",
    name: "Care Team",
    role: "Group Chat",
    preview: "Morning rounds scheduled for 8 AM...",
    time: "3 h ago",
    unread: 0,
    online: false,
    color: "pink",
  },
];

export default function MessageList() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const filteredMessages = useMemo(() => {
    return messageListData.filter((item) => {
      const target = `${item.name} ${item.role} ${item.preview}`.toLowerCase();
      return target.includes(query.toLowerCase());
    });
  }, [query]);

  return (
    <div className="mobile-shell">
      <div className="message-list-screen">
        <div className="message-list-header">
          <div className="message-list-topbar">
            <button
              className="message-list-back-btn"
              onClick={() => navigate("/home")}
              aria-label="Back to Home"
            >
                <FaArrowLeft />
            </button>

            <div className="message-list-title-wrap">
              <h1 className="type-h2">Messages</h1>
              <p className="type-body-lg">{filteredMessages.length} conversations</p>
            </div>

            <button className="message-list-menu-btn" aria-label="More">
              ⋮
            </button>
          </div>
        </div>

        <div className="message-list-search-wrap">
          <input
            className="message-list-search-input type-body-lg"
            placeholder="Search messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="message-list-items">
          {filteredMessages.map((item) => (
            <button
              key={item.id}
              className="message-list-item"
              onClick={() => navigate(`/messages/${item.id}`)}
            >
              <div className={`message-list-avatar ${item.color}`}>
                {item.initials}
              </div>

              <div className="message-list-content">
                <div className="message-list-row">
                  <div className="message-list-name-wrap">
                    <h3 className="type-h4">{item.name}</h3>
                    {item.role ? (
                      <p className="type-body-md message-list-role">{item.role}</p>
                    ) : null}
                  </div>

                  <div className="message-list-meta">
                    <span className="type-body-sm">{item.time}</span>
                    {item.unread > 0 && (
                      <span className="message-unread-badge type-body-sm">
                        {item.unread}
                      </span>
                    )}
                  </div>
                </div>

                <div className="message-list-preview-row">
                  {item.online && <span className="message-online-dot"></span>}
                  <p className="type-body-lg message-list-preview">{item.preview}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}