import {
  cancelBooking,
  createBooking,
  getAppointmentTypes,
  getBookingConfirmation,
  getMyBookings,
  getDoctorsByType,
  getSchedule,
} from "../api/booking";
import { watchBookingSchedule } from "./bookingRealtimeService";

export const bookingService = {
  getAppointmentTypes,
  getDoctorsByType,
  getSchedule,
  createBooking,
  getBookingConfirmation,
  getMyBookings,
  cancelBooking,
  watchSchedule: watchBookingSchedule,
};
