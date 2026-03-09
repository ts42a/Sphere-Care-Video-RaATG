import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { callContacts } from "../../mock/callData";
import { AiFillAudio } from "react-icons/ai";
import { HiMiniSpeakerWave } from "react-icons/hi2";
import { FaVideo } from "react-icons/fa6";
import { MdPersonAddAlt1 } from "react-icons/md";
import { FaPhone } from "react-icons/fa6";
import { FaArrowLeft } from "react-icons/fa";
import { HiOutlineDotsVertical } from "react-icons/hi";

export default function AudioCall() {
  const navigate = useNavigate();
  const { contactId } = useParams();

  const contact = useMemo(
    () => callContacts.find((item) => item.id === contactId) || callContacts[0],
    [contactId]
  );

  return (
    <div className="mobile-shell audio-call-shell">
      <div className="audio-call-screen">
        <div className="audio-call-topbar">
          <button onClick={() => navigate(-1)}><FaArrowLeft /></button>
          <span className="type-body-lg">00:04</span>
          <button><HiOutlineDotsVertical /></button>
        </div>

        <div className="audio-avatar-wrap">
          <div className="audio-avatar-large"></div>
          <span className="audio-online-dot"></span>
        </div>

        <h2 className="type-h2 audio-name">{contact.name}</h2>
        <p className="type-body-lg audio-role">{contact.specialty}</p>
        <div className="audio-status-pill type-body-md">Connected</div>

        <div className="audio-control-grid">
          <div className="audio-control-card"><AiFillAudio /><span className="type-body-lg">Mute</span></div>
          <div className="audio-control-card"><HiMiniSpeakerWave /><span className="type-body-lg">Speaker</span></div>
          <div className="audio-control-card"><FaVideo /><span className="type-body-lg">Video</span></div>
          <div className="audio-control-card"><MdPersonAddAlt1 /><span className="type-body-lg">Add</span></div>
        </div>

        <div className="audio-connection type-body-lg">Excellent connection</div>

        <div className="audio-bottom-actions">
          <button className="audio-small-btn">⌨</button>
          <button className="audio-end-btn" onClick={() => navigate("/call")}><FaPhone /></button>
        </div>
      </div>
    </div>
  );
}