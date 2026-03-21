export type AppointmentType = {
  id: string;
  title: string;
  duration: string;
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
};

export type ScheduleResponse = {
  doctor: Doctor;
  availableDates: string[];
  timeSlots: TimeSlot[];
};

export type CreateBookingPayload = {
  doctorId: string;
  typeId: string;
  typeTitle: string;
  doctorName: string;
  doctorRole: string;
  date: string;
  time: string;
};

export type CreateBookingResponse = {
  bookingId: string;
};

export type BookingConfirmation = {
  bookingId: string;
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
  status: string;
};
