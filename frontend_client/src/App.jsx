import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import BookingHome from "./pages/booking/BookingHome";
import BookingDoctors from "./pages/booking/BookingDoctors";
import BookingSchedule from "./pages/booking/BookingSchedule";
import CallCenter from "./pages/call/CallCenter";
import AudioCall from "./pages/call/AudioCall";
import VideoCall from "./pages/call/VideoCall";
import MessageList from "./pages/call/MessageList";
import MessageChat from "./pages/call/MessageChat";
import TaskPage from "./pages/Task";
import NotificationsPage from "./pages/Notification";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import VerifyCodePage from "./pages/auth/VerifyCodePage";
import SetPasswordPage from "./pages/auth/SetPasswordPage";
import ResetSuccessPage from "./pages/auth/ResetSuccessPage";

import "./home.css";
import "./booking.css";
import "./call.css";
import "./notification.css";
import "./auth.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/home" element={<Home />} />

        <Route path="/booking" element={<BookingHome />} />
        <Route path="/booking/doctors/:appointmentType" element={<BookingDoctors />} />
        <Route path="/booking/schedule/:appointmentType/:doctorId" element={<BookingSchedule />} />

        <Route path="/call" element={<CallCenter />} />
        <Route path="/call/audio/:contactId" element={<AudioCall />} />
        <Route path="/call/video/:contactId" element={<VideoCall />} />

        <Route path="/messages" element={<MessageList />} />
        <Route path="/messages/:contactId" element={<MessageChat />} />

        <Route path="/tasks" element={<TaskPage />} />

        <Route path="/notifications" element={<NotificationsPage />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/forgot-password/verify" element={<VerifyCodePage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/password-reset-success" element={<ResetSuccessPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;