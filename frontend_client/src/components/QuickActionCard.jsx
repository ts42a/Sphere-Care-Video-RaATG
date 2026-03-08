import callIcon from "../assets/icons/call.svg";
import bookingIcon from "../assets/icons/booking.svg";

export default function QuickActionCard({
  smallTitle,
  bigTitle,
  variant,
  icon,
}) {
  const iconSrc = icon === "call" ? callIcon : bookingIcon;

  return (
    <div className={`quick-card ${variant}`}>
      <div className="quick-card-text">
        {icon === "call" ? (
          <>
            <h3>{bigTitle}</h3>
            <p>{smallTitle}</p>
          </>
        ) : (
          <>
            <p>{smallTitle}</p>
            <h3>{bigTitle}</h3>
          </>
        )}
      </div>

      <div className="quick-card-icon">
        <img src={iconSrc} alt={icon} className="quick-card-icon-img" />
      </div>
    </div>
  );
}