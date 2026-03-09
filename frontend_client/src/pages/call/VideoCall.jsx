import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { callContacts, transcriptLines } from "../../mock/callData";
import { FaPhone } from "react-icons/fa6";
import { AiFillAudio } from "react-icons/ai";
import { FaVideo } from "react-icons/fa";

export default function VideoCall() {
  const navigate = useNavigate();
  const { contactId } = useParams();
  const [expanded, setExpanded] = useState(false);

  const contact = useMemo(
    () => callContacts.find((item) => item.id === contactId) || callContacts[0],
    [contactId]
  );

  return (
    <div className="mobile-shell video-call-shell">
      <div className="video-call-screen">
        <div className="video-topbar">
          <div className="type-body-lg">🔴 00:30</div>
          <div className="video-ai-pill type-body-md">AI Transcribing</div>
        </div>

        <div className="video-contact-mini type-body-lg">{contact.name}</div>
        <div className="video-quality type-body-md">HD Quality</div>

        <div className="video-main-profile">
          <div className={`video-avatar-large ${contact.color}`}>{contact.initials}</div>
          <h2 className="type-h2 video-main-name">{contact.name}</h2>
          <p className="type-body-lg video-main-role">{contact.specialty}</p>
        </div>

        <div className={`transcript-panel ${expanded ? "expanded" : ""}`}>
          <div className="transcript-header">
            <div className="type-h4">AI Live Transcript ●</div>
            <div className="transcript-actions">
              <button>⧉</button>
              <button>⇩</button>
              <button onClick={() => setExpanded(!expanded)}>{expanded ? "⌄" : "⌃"}</button>
            </div>
          </div>

          <div className="transcript-body">
            {transcriptLines.map((line, index) => (
              <div key={index} className="transcript-line type-body-lg">
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className="video-bottom-controls">
          <div className="video-control-item">
            <button className="video-control-btn"><AiFillAudio /></button>
            <span className="type-body-lg">Mute</span>
          </div>

          <div className="video-control-item">
            <button className="video-end-btn" onClick={() => navigate("/call")}><FaPhone /></button>
            <span className="type-body-lg">End</span>
          </div>

          <div className="video-control-item">
            <button className="video-control-btn"><FaVideo /></button>
            <span className="type-body-lg">Stop</span>
          </div>
        </div>
      </div>
    </div>
  );
}