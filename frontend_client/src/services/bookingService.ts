import {
  cancelBooking,
  createBooking,
  getAppointmentTypes,
  getBookingConfirmation,
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
  cancelBooking,
  watchSchedule: watchBookingSchedule,
};
