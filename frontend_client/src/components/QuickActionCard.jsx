import callIcon from "../assets/icons/call.svg";
import bookingIcon from "../assets/icons/booking.svg";

export default function QuickActionCard({
  smallTitle,
  bigTitle,
  variant,
  icon,
  onClick,
}) {
  const iconSrc = icon === "call" ? callIcon : bookingIcon;

  return (
    <div className={`quick-card ${variant}`} onClick={onClick}>
      <div className="quick-card-text">
       {icon === "call" ? (
          <>
            <h3 className="type-h3">{bigTitle}</h3>
            <p className="type-body-lg">{smallTitle}</p>
          </>
        ) : (
          <>
            <p className="type-body-lg">{smallTitle}</p>
            <h3 className="type-h3">{bigTitle}</h3>
          </>
        )}
      </div>

      <div className="quick-card-icon">
        <img src={iconSrc} alt={icon} className="quick-card-icon-img" />
      </div>
    </div>
  );
}