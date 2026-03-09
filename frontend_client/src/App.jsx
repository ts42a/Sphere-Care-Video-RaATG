import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import BookingHome from "./pages/booking/BookingHome";
import BookingDoctors from "./pages/booking/BookingDoctors";
import BookingSchedule from "./pages/booking/BookingSchedule";
import CallCenter from "./pages/call/CallCenter";
import AudioCall from "./pages/call/AudioCall";
import VideoCall from "./pages/call/VideoCall";
import MessageChat from "./pages/call/MessageChat";
import "./home.css";
import "./booking.css";
import "./call.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />

        <Route path="/booking" element={<BookingHome />} />
        <Route path="/booking/doctors/:appointmentType" element={<BookingDoctors />} />
        <Route path="/booking/schedule/:appointmentType/:doctorId" element={<BookingSchedule />} />

        <Route path="/call" element={<CallCenter />} />
        <Route path="/call/audio/:contactId" element={<AudioCall />} />
        <Route path="/call/video/:contactId" element={<VideoCall />} />
        <Route path="/messages/:contactId" element={<MessageChat />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;