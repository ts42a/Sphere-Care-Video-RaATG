import { useNavigate } from "react-router-dom";
import HeaderBar from "../components/HeaderBar";
import ReminderCard from "../components/ReminderCard";
import QuickActionCard from "../components/QuickActionCard";
import TaskCard from "../components/TaskCard";
import BottomNav from "../components/BottomNav";

export default function Home() {
  const navigate = useNavigate();

  const tasks = [
    {
      id: 1,
      category: "Medication",
      name: "Name of the medication in full",
      time: "8:00",
      type: "green",
      icon: "pill",
    },
    {
      id: 2,
      category: "Medication",
      name: "Name of the medication in full",
      time: "8:00",
      type: "orange",
      icon: "walk",
    },
    {
      id: 3,
      category: "Medication",
      name: "Name of the medication in full",
      time: "8:00",
      type: "red",
      icon: "meal",
    },
  ];

  return (
    <div className="mobile-shell">
      <div className="home-screen">
        <HeaderBar userName="Name" />

        <ReminderCard
          title="Time to check your"
          highlight="Blood pressure"
          primaryText="Check Now"
          secondaryText="Remind Later"
        />

        <div className="quick-actions-row">
          <QuickActionCard
            bigTitle="CALL"
            smallTitle="Someone"
            variant="purple"
            icon="call"
          />
          <QuickActionCard
            smallTitle="Manage"
            bigTitle="BOOKING"
            variant="mint"
            icon="booking"
            onClick={() => navigate("/booking")}
          />
        </div>

        <div className="task-header">
          <h2 className="type-h1">Today’s Task</h2>
          <button className="task-add-btn">+</button>
        </div>

        <div className="task-list">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              category={task.category}
              name={task.name}
              time={task.time}
              type={task.type}
              icon={task.icon}
            />
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}