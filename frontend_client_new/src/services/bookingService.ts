import {
  fetchDoctors,
  fetchSchedule,
  createBooking,
} from "../api/booking";

export const bookingService = {
  getDoctors: fetchDoctors,
  getSchedule: fetchSchedule,
  createBooking,
};