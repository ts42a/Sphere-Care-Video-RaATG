import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BottomNav from "../../components/BottomNav";
import { callContacts, chatMessages } from "../../mock/callData";
import { FaPhone } from "react-icons/fa6";
import { FaVideo } from "react-icons/fa6";
import { FaCircleInfo } from "react-icons/fa6";
import { RiMessage2Fill } from "react-icons/ri";
import { IoSend } from "react-icons/io5";
import { IoCheckmarkDone } from "react-icons/io5";
import { FaArrowLeft } from "react-icons/fa";

export default function MessageChat() {
  const navigate = useNavigate();
  const { contactId } = useParams();

  const contact = useMemo(
    () => callContacts.find((item) => item.id === contactId) || callContacts[0],
    [contactId]
  );

  const messages = chatMessages[contactId] || [];

  return (
    <div className="mobile-shell">
      <div className="message-screen">
        <div className="message-header">
          <button className="message-back-btn" onClick={() => navigate(-1)}><FaArrowLeft /></button>

          <div className={`message-avatar ${contact.color}`}>{contact.initials}</div>

          <div className="message-contact-meta">
            <h2 className="type-h4">{contact.name}</h2>
            <p className="type-body-md message-online">● Online</p>
          </div>

          <div className="message-header-actions">
            <button onClick={() => navigate(`/call/audio/${contact.id}`)}><FaPhone /></button>
            <button onClick={() => navigate(`/call/video/${contact.id}`)}><FaVideo /></button>
            <button><FaCircleInfo /></button>
          </div>
        </div>

        <div className="message-thread">
          {messages.map((msg) => (
            <div key={msg.id} className={`message-block ${msg.sender}`}>
              {msg.sender === "doctor" && (
                <>
                  <div className="message-bubble doctor type-body-lg">{msg.text}</div>
                  <div className="message-meta type-body-sm">{msg.time}  {msg.name}</div>
                </>
              )}

              {msg.sender === "me" && (
                <>
                  <div className="message-bubble me type-body-lg">{msg.text}</div>
                  <div className="message-meta right type-body-sm">{msg.time} <IoCheckmarkDone /></div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="message-input-row">
          <button className="message-attach-btn"><RiMessage2Fill /></button>
          <input className="message-input type-body-md" placeholder="Type a message..." />
          <button className="message-send-btn"><IoSend /></button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}