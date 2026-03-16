export type BookingDoctor = {
  id: string;
  name: string;
  specialty: string;
  avatar?: string;
};

export type TimeSlot = {
  id: string;
  time: string;
  available: boolean;
};

export type ScheduleResponse = {
  date: string;
  slots: TimeSlot[];
};