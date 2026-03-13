import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import { FaArrowLeft } from "react-icons/fa";

const initialNotifications = [
  {
    id: "n1",
    title: "Medication Due",
    message: "Patient Anderson – Blood pressure medication due in 15 minutes",
    timeAgo: "2 m ago",
    read: false,
    actionLabel: "View Details",
    actionColor: "danger",
    color: "soft-red",
  },
  {
    id: "n2",
    title: "Task Completed",
    message: "Morning vitals check completed for all assigned patients",
    timeAgo: "5 m ago",
    read: false,
    actionLabel: "",
    actionColor: "",
    color: "soft-green",
  },
  {
    id: "n3",
    title: "Lab Results Available",
    message: "New lab results are ready for review",
    timeAgo: "10 m ago",
    read: false,
    actionLabel: "View Results",
    actionColor: "primary",
    color: "soft-blue",
  },
  {
    id: "n4",
    title: "Shift Handoff",
    message: "Evening shift handoff scheduled in 30 minutes",
    timeAgo: "15 m ago",
    read: true,
    actionLabel: "",
    actionColor: "",
    color: "soft-yellow",
  },
];

function NotificationIcon({ color }) {
  return <div className={`notification-avatar ${color}`}></div>;
}

function NotificationActionButton({ actionLabel, colorClass }) {
  if (!actionLabel) return null;

  return (
    <button className={`notification-action-btn ${colorClass}`}>
      {actionLabel}
    </button>
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [activeFilter, setActiveFilter] = useState("all");

  function handleMarkRead(notificationId) {
    setNotifications((current) =>
      current.map((item) =>
        item.id === notificationId ? { ...item, read: true } : item
      )
    );
  }

  function handleMarkAllRead() {
    setNotifications((current) =>
      current.map((item) => ({ ...item, read: true }))
    );
  }

  const unreadCount = useMemo(() => {
    return notifications.filter((item) => !item.read).length;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (activeFilter === "unread") {
      return notifications.filter((item) => !item.read);
    }
    return notifications;
  }, [notifications, activeFilter]);

  return (
    <div className="mobile-shell">
      <div className="notification-screen">
        <div className="notification-topbar">
          <button
            className="notification-back-btn"
            onClick={() => navigate("/home")}
            aria-label="Back to home"
          >
            <FaArrowLeft />
          </button>

          <div className="notification-title-wrap">
            <h1 className="type-h2">Notifications</h1>
          </div>

          <button className="notification-menu-btn" aria-label="More">
            ⋮
          </button>
        </div>

        <div className="notification-meta-row">
          <p className="type-body-lg">{unreadCount} unread</p>
          <button
            className="notification-mark-all type-body-lg"
            onClick={handleMarkAllRead}
          >
            Mark all read
          </button>
        </div>

        <div className="notification-filter-row">
          <button
            className={`notification-filter-btn type-body-lg ${
              activeFilter === "all" ? "active" : ""
            }`}
            onClick={() => setActiveFilter("all")}
          >
            All
          </button>

          <button
            className={`notification-filter-btn type-body-lg ${
              activeFilter === "unread" ? "active" : ""
            }`}
            onClick={() => setActiveFilter("unread")}
          >
            Unread {unreadCount > 0 ? `(${unreadCount})` : ""}
          </button>
        </div>

        <div className="notification-list">
          {filteredNotifications.map((item) => (
            <div key={item.id} className="notification-card">
              <NotificationIcon color={item.color} />

              <div className="notification-content">
                <div className="notification-header-row">
                  <h3 className="type-h4">{item.title}</h3>
                  <span className="type-body-sm notification-time">
                    {item.timeAgo}
                  </span>
                </div>

                <p className="type-body-lg notification-message">
                  {item.message}
                </p>

                <div className="notification-actions-row">
                  <NotificationActionButton
                    actionLabel={item.actionLabel}
                    colorClass={item.actionColor}
                  />

                  {!item.read && (
                    <button
                      className="notification-mark-read type-body-lg"
                      onClick={() => handleMarkRead(item.id)}
                    >
                      Mark read
                    </button>
                  )}

                  {item.read && (
                    <span className="notification-read-label type-body-sm">
                      Read
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {filteredNotifications.length === 0 && (
            <div className="notification-empty-state type-body-lg">
              No notifications found
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}