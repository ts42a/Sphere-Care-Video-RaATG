import {
  createBooking,
  getAppointmentTypes,
  getBookingConfirmation,
  getDoctorsByType,
  getSchedule,
} from "../api/booking";

export const bookingService = {
  getAppointmentTypes,
  getDoctorsByType,
  getSchedule,
  createBooking,
  getBookingConfirmation,
};
