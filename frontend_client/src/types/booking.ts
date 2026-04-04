export type AppointmentType = {
  id: string;
  title: string;
  durationMinutes?: number;
};

export type Doctor = {
  id: string;
  name: string;
  role: string;
  available: boolean;
  rating: number;
  experience: string;
  price: string;
  specialty?: string;
};

export type TimeSlot = {
  id: string;
  label: string;
  available: boolean;
};

export type ScheduleResponse = {
  doctor: {
    id: string;
    name: string;
    role: string;
  };
  date: string;
  availableDates: string[];
  timeSlots: TimeSlot[];
  version: number;
};

export type CreateBookingInput = {
  appointmentTypeId: string;
  doctorId: string;
  date: string;
  timeSlotId: string;
};

export type BookingConfirmation = {
  bookingId: string;
  status: string;
  doctor: {
    id: string;
    name: string;
    role: string;
  };
  appointmentType: {
    id: string;
    title: string;
  };
  date: string;
  time: string;
  room: string;
  createdAt?: string;
};
