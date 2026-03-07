import pillIcon from "../assets/icons/pill.svg";
import walkIcon from "../assets/icons/walk.svg";
import mealIcon from "../assets/icons/meal.svg";

export default function TaskCard({ category, name, time, type, icon }) {
  let iconSrc = pillIcon;

  if (icon === "walk") iconSrc = walkIcon;
  if (icon === "meal") iconSrc = mealIcon;

  return (
    <div className={`task-card ${type}`}>
      <div className="task-left-line"></div>

      <div className="task-icon-box">
        <img src={iconSrc} alt={icon} className="task-icon-img" />
      </div>

      <div className="task-content">
        <p className="task-category">{category}</p>
        <h4 className="task-name">{name}</h4>
      </div>

      <div className={`task-time ${type}`}>{time}</div>
    </div>
  );
}