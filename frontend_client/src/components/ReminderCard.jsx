export default function ReminderCard({
  title,
  highlight,
  primaryText,
  secondaryText,
}) {
  return (
    <div className="reminder-card">
      <h1 className="reminder-title">
        {title}
        <br />
        <span>{highlight}</span>
      </h1>

      <div className="reminder-actions">
        <button className="primary-btn">{primaryText}</button>
        <button className="secondary-btn">{secondaryText}</button>
      </div>
    </div>
  );
}