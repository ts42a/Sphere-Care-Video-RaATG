export default function ReminderCard({
  title,
  highlight,
  primaryText,
  secondaryText,
}) {

  const words = title.split(" ");
  const firstWord = words[0];
  const rest = words.slice(1).join(" ");

  return (
    <div className="reminder-card">
      <div className="reminder-title-wrap">
        <h1 className="reminder-title-main">
          <span className="reminder-light">{firstWord}</span> {rest}
        </h1>

        <h2 className="reminder-title-highlight">{highlight}</h2>
      </div>

      <div className="reminder-actions">
        <button className="primary-btn type-h4">{primaryText}</button>
        <button className="secondary-btn type-body-lg">{secondaryText}</button>
      </div>
    </div>
  );
}