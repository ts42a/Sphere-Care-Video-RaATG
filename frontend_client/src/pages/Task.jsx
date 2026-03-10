import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import HeaderBar from "../components/HeaderBar";
import BottomNav from "../components/BottomNav";
import pillIcon from "../assets/icons/pill.svg";
import walkIcon from "../assets/icons/walk.svg";
import mealIcon from "../assets/icons/meal.svg";

const taskData = [
  {
    id: 1,
    category: "Medication",
    name: "Vitamin D 1000 IU",
    time: "8:00",
    type: "green",
    status: "today",
    icon: "pill",
  },
  {
    id: 2,
    category: "Exercise",
    name: "Morning walk for 20 minutes",
    time: "8:30",
    type: "orange",
    status: "today",
    icon: "walk",
  },
  {
    id: 3,
    category: "Meal",
    name: "Warm soup and soft diet",
    time: "9:00",
    type: "red",
    status: "today",
    icon: "meal",
  },
  {
    id: 4,
    category: "Medication",
    name: "Blood pressure tablet",
    time: "10:00",
    type: "green",
    status: "completed",
    icon: "pill",
  },
  {
    id: 5,
    category: "Hydration",
    name: "Drink 250 ml of water",
    time: "10:30",
    type: "green",
    status: "completed",
    icon: "meal",
  },
  {
    id: 6,
    category: "Exercise",
    name: "Stretching with caregiver",
    time: "11:00",
    type: "orange",
    status: "upcoming",
    icon: "walk",
  },
  {
    id: 7,
    category: "Medication",
    name: "Afternoon insulin check",
    time: "12:00",
    type: "green",
    status: "upcoming",
    icon: "pill",
  },
  {
    id: 8,
    category: "Meal",
    name: "Lunch and hydration reminder",
    time: "12:30",
    type: "orange",
    status: "upcoming",
    icon: "meal",
  },
  {
    id: 9,
    category: "Medication",
    name: "Calcium supplement",
    time: "7:30",
    type: "red",
    status: "miss",
    icon: "pill",
  },
  {
    id: 10,
    category: "Exercise",
    name: "Balance practice",
    time: "2:00",
    type: "orange",
    status: "miss",
    icon: "walk",
  },
  {
    id: 11,
    category: "Meal",
    name: "Breakfast check completed",
    time: "7:00",
    type: "green",
    status: "completed",
    icon: "meal",
  },
  {
    id: 12,
    category: "Medication",
    name: "Evening pain relief tablet",
    time: "6:00",
    type: "green",
    status: "upcoming",
    icon: "pill",
  },
];

const iconMap = {
  pill: pillIcon,
  walk: walkIcon,
  meal: mealIcon,
};

function TaskIcon({ icon, type }) {
  return (
    <img
      src={iconMap[icon] || pillIcon}
      alt={icon}
      className={`task-page-icon-symbol ${type}`}
    />
  );
}

function TaskCard({ task }) {
  return (
    <div className={`task-card ${task.type}`}>
      <div className="task-left-line"></div>

      <div className="task-icon-box">
        <TaskIcon icon={task.icon} type={task.type} />
      </div>

      <div className="task-content">
        <p className="task-category type-body-md">{task.category}</p>
        <h4 className="task-name type-h4">{task.name}</h4>
      </div>

      <div className={`task-time ${task.type} type-h4`}>{task.time}</div>
    </div>
  );
}

export default function TaskPage() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState("today");

  const filteredTasks = useMemo(() => {
    return taskData.filter((task) => task.status === activeFilter);
  }, [activeFilter]);

  return (
    <div className="mobile-shell">
      <div className="task-page-screen">
        <HeaderBar title="Daily Task" showBack />

        <div className="task-ai-card">
          <div className="task-ai-icon">AI</div>

          <div className="task-ai-content">
            <p className="type-body-lg">
              Resident slept 2h less last night. Suggest starting morning walk later today.
            </p>
            <button className="task-ai-link type-body-lg">
              Apply to Schedule →
            </button>
          </div>
        </div>

        <div className="task-filter-row">
          <button
            className={`task-filter-btn type-body-lg ${activeFilter === "today" ? "active" : ""}`}
            onClick={() => setActiveFilter("today")}
          >
            Today
          </button>

          <button
            className={`task-filter-btn type-body-lg ${activeFilter === "upcoming" ? "active" : ""}`}
            onClick={() => setActiveFilter("upcoming")}
          >
            Upcoming
          </button>

          <button
            className={`task-filter-btn type-body-lg ${activeFilter === "completed" ? "active" : ""}`}
            onClick={() => setActiveFilter("completed")}
          >
            Completed
          </button>

          <button
            className={`task-filter-btn type-body-lg ${activeFilter === "miss" ? "active" : ""}`}
            onClick={() => setActiveFilter("miss")}
          >
            Miss
          </button>
        </div>

        <div className="task-page-list">
          {filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}