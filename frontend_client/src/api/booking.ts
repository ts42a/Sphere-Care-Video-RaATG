import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import type { ApiItemResponse, ApiListResponse } from "../types/api";
import type {
  AppointmentType,
  BookingConfirmation,
  CreateBookingPayload,
  CreateBookingResponse,
  Doctor,
  ScheduleResponse,
} from "../types/booking";

let latestBooking: BookingConfirmation | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function generateAvailableDates(weeksAhead = 4): string[] {
  const results: string[] = [];
  const today = new Date();
  const totalDays = weeksAhead * 7;

  for (let i = 1; i <= totalDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const day = d.getDay();
    const isWeekend = day === 0 || day === 6;

    if (!isWeekend) {
      results.push(toDateKey(d));
    }
  }

  return results;
}

async function getMockAppointmentTypes(): Promise<AppointmentType[]> {
  await wait(200);

  return [
    { id: "general-checkup", title: "General Check up", duration: "30 min" },
    { id: "follow-up", title: "Follow up Visit", duration: "30 min" },
    { id: "consultation", title: "Consultation Check up", duration: "30 min" },
    { id: "lab-test", title: "LAB Test", duration: "30 min" },
    { id: "review-med", title: "Review Med", duration: "30 min" },
    { id: "vaccination", title: "Vaccination", duration: "30 min" },
  ];
}

async function getMockDoctorsByType(_typeId: string): Promise<Doctor[]> {
  await wait(200);

  return [
    {
      id: "doc-1",
      name: "Dr. Jack Specs",
      role: "General Practitioner",
      available: true,
      rating: 4.8,
      experience: "8 years exp",
      price: "$120/h",
      specialty: "General Care",
    },
    {
      id: "doc-2",
      name: "Dr. Emily Ross",
      role: "General Practitioner",
      available: false,
      rating: 4.6,
      experience: "10 years exp",
      price: "$130/h",
      specialty: "General Care",
    },
    {
      id: "doc-3",
      name: "Dr. Michael Chen",
      role: "General Practitioner",
      available: true,
      rating: 4.9,
      experience: "12 years exp",
      price: "$135/h",
      specialty: "General Care",
    },
    {
      id: "doc-4",
      name: "Dr. Helen Cruz",
      role: "General Practitioner",
      available: false,
      rating: 4.5,
      experience: "9 years exp",
      price: "$118/h",
      specialty: "General Care",
    },
    {
      id: "doc-5",
      name: "Dr. Robert Kim",
      role: "General Practitioner",
      available: true,
      rating: 4.7,
      experience: "11 years exp",
      price: "$128/h",
      specialty: "General Care",
    },
  ];
}

async function getMockSchedule(
  doctorId: string,
  typeId: string
): Promise<ScheduleResponse> {
  await wait(200);

  const doctors = await getMockDoctorsByType(typeId);
  const doctor = doctors.find((item) => item.id === doctorId) ?? doctors[0];

  return {
    doctor,
    availableDates: generateAvailableDates(4),
    timeSlots: [
      { id: "slot-1", label: "9:00 AM - 9:30 AM" },
      { id: "slot-2", label: "9:30 AM - 10:00 AM" },
      { id: "slot-3", label: "10:30 AM - 11:00 AM" },
      { id: "slot-4", label: "11:00 AM - 11:30 AM" },
    ],
  };
}

export async function getAppointmentTypes(): Promise<AppointmentType[]> {
  if (USE_MOCK_API) {
    return getMockAppointmentTypes();
  }

  const response = await request<ApiListResponse<AppointmentType>>("/appointments/types");
  return response.data;
}

export async function getDoctorsByType(typeId: string): Promise<Doctor[]> {
  if (USE_MOCK_API) {
    return getMockDoctorsByType(typeId);
  }

  const query = typeId ? `?typeId=${encodeURIComponent(typeId)}` : "";
  const response = await request<ApiListResponse<Doctor>>(`/appointments/doctors${query}`);
  return response.data;
}

export async function getSchedule(
  doctorId: string,
  typeId: string
): Promise<ScheduleResponse> {
  if (USE_MOCK_API) {
    return getMockSchedule(doctorId, typeId);
  }

  const query = new URLSearchParams({ doctorId, typeId }).toString();
  const response = await request<ApiItemResponse<ScheduleResponse>>(
    `/appointments/schedule?${query}`
  );
  return response.data;
}

export async function createBooking(
  payload: CreateBookingPayload
): Promise<CreateBookingResponse> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<CreateBookingResponse>>("/appointments/book", {
      method: "POST",
      body: payload,
    });
    return response.data;
  }

  await wait(200);

  const bookingId = `booking-${Date.now()}`;

  latestBooking = {
    bookingId,
    doctor: {
      id: payload.doctorId,
      name: payload.doctorName,
      role: payload.doctorRole,
    },
    appointmentType: {
      id: payload.typeId,
      title: payload.typeTitle,
    },
    date: payload.date,
    time: payload.time,
    room: "Room 203 - Main Care Unit",
    status: "Confirmed",
  };

  return { bookingId };
}

export async function getBookingConfirmation(
  bookingId: string
): Promise<BookingConfirmation> {
  if (!USE_MOCK_API) {
    const response = await request<ApiItemResponse<BookingConfirmation>>(
      `/appointments/${bookingId}`
    );
    return response.data;
  }

  await wait(200);

  if (!latestBooking || latestBooking.bookingId !== bookingId) {
    throw new Error("Booking not found");
  }

  return latestBooking;
}
