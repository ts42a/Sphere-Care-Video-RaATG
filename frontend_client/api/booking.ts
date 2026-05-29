import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import type { ApiItemResponse, ApiListResponse } from "../types/api";
import type {
  AppointmentType,
  BookingConfirmation,
  CreateBookingInput,
  Doctor,
  ScheduleResponse,
  TimeSlot,
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

function generateAvailableDates(daysAhead = 28): string[] {
  const results: string[] = [];
  const today = new Date();

  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const weekday = d.getDay();
    const isWeekend = weekday === 0 || weekday === 6;

    if (!isWeekend) {
      results.push(toDateKey(d));
    }
  }

  return results;
}

function unwrapList<T>(response: T[] | ApiListResponse<T>): T[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (response && Array.isArray(response.data)) {
    return response.data;
  }

  return [];
}

function unwrapItem<T>(response: T | ApiItemResponse<T>): T {
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    (response as ApiItemResponse<T>).data !== undefined
  ) {
    return (response as ApiItemResponse<T>).data;
  }

  return response as T;
}

function normalizeAppointmentType(item: any): AppointmentType {
  return {
    id: String(item?.id ?? ""),
    title: String(item?.title ?? item?.name ?? "Appointment"),
    durationMinutes:
      typeof item?.durationMinutes === "number"
        ? item.durationMinutes
        : typeof item?.duration_minutes === "number"
        ? item.duration_minutes
        : typeof item?.duration === "number"
        ? item.duration
        : typeof item?.duration === "string"
        ? Number.parseInt(item.duration, 10) || undefined
        : undefined,
  };
}

function normalizeDoctor(item: any): Doctor {
  return {
    id: String(item?.id ?? ""),
    name: String(item?.name ?? "Unknown Doctor"),
    role: String(item?.role ?? item?.specialty ?? "General Practitioner"),
    available: Boolean(item?.available ?? item?.isAvailable ?? true),
    rating:
      typeof item?.rating === "number"
        ? item.rating
        : Number(item?.rating ?? 0) || 0,
    experience: String(item?.experience ?? "N/A"),
    price: String(item?.price ?? "N/A"),
    specialty:
      typeof item?.specialty === "string" ? item.specialty : undefined,
  };
}

function makeFallbackSlotId(item: any, label: string, index: number) {
  const rawStart = item?.start ?? item?.start_time ?? "";
  const rawEnd = item?.end ?? item?.end_time ?? "";
  const seed = `${rawStart}-${rawEnd}-${label}-${index}`
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .toLowerCase();

  return `slot-${seed || index}`;
}

function normalizeTimeSlot(item: any, index: number): TimeSlot {
  const start =
    typeof item?.start === "string"
      ? item.start
      : typeof item?.start_time === "string"
      ? item.start_time
      : undefined;

  const end =
    typeof item?.end === "string"
      ? item.end
      : typeof item?.end_time === "string"
      ? item.end_time
      : undefined;

  const label =
    item?.label ??
    item?.time ??
    item?.displayTime ??
    (start && end ? `${start} - ${end}` : "Unknown time");

  const id =
    item?.id ??
    item?.timeSlotId ??
    item?.time_slot_id ??
    item?.slotId ??
    item?.slot_id ??
    makeFallbackSlotId(item, String(label), index);

  return {
    id: String(id),
    label: String(label),
    available: Boolean(item?.available ?? item?.isAvailable ?? true),
    start,
    end,
  };
}

function normalizeSchedule(item: any): ScheduleResponse {
  const rawDoctor = item?.doctor ?? item?.provider ?? {};
  const rawDates = Array.isArray(item?.availableDates)
    ? item.availableDates
    : Array.isArray(item?.available_dates)
    ? item.available_dates
    : Array.isArray(item?.dates)
    ? item.dates
    : generateAvailableDates();

  const rawSlots = Array.isArray(item?.timeSlots)
    ? item.timeSlots
    : Array.isArray(item?.time_slots)
    ? item.time_slots
    : Array.isArray(item?.slots)
    ? item.slots
    : [];

  return {
    doctor: {
      id: String(rawDoctor?.id ?? ""),
      name: String(rawDoctor?.name ?? "Unknown Doctor"),
      role: String(
        rawDoctor?.role ?? rawDoctor?.specialty ?? "General Practitioner"
      ),
      availabilitySummary:
        typeof rawDoctor?.availabilitySummary === "string"
          ? rawDoctor.availabilitySummary
          : typeof rawDoctor?.availability_summary === "string"
          ? rawDoctor.availability_summary
          : undefined,
    },
    date: String(item?.date ?? rawDates[0] ?? ""),
    availableDates: rawDates.map((date: unknown) => String(date)),
    timeSlots: rawSlots.map((slot: any, index: number) => normalizeTimeSlot(slot, index)),
    version:
      typeof item?.version === "number"
        ? item.version
        : Number(item?.version ?? 1) || 1,
  };
}

function normalizeBookingConfirmation(item: any): BookingConfirmation {
  return {
    bookingId: String(item?.bookingId ?? item?.booking_id ?? item?.id ?? ""),
    status: String(item?.status ?? "confirmed"),
    doctor: {
      id: String(item?.doctor?.id ?? item?.doctorId ?? item?.doctor_id ?? ""),
      name: String(
        item?.doctor?.name ?? item?.doctorName ?? item?.doctor_name ?? "Unknown Doctor"
      ),
      role: String(
        item?.doctor?.role ?? item?.doctorRole ?? item?.doctor_role ?? "General Practitioner"
      ),
    },
    appointmentType: {
      id: String(
        item?.appointmentType?.id ??
          item?.appointment_type?.id ??
          item?.appointmentTypeId ??
          item?.appointment_type_id ??
          item?.typeId ??
          ""
      ),
      title: String(
        item?.appointmentType?.title ??
          item?.appointment_type?.title ??
          item?.appointmentTypeTitle ??
          item?.appointment_type_title ??
          item?.typeTitle ??
          "Appointment"
      ),
    },
    date: String(item?.date ?? ""),
    time: String(item?.time ?? item?.timeLabel ?? item?.time_label ?? ""),
    room: String(item?.room ?? item?.location ?? "TBC"),
    createdAt:
      typeof item?.createdAt === "string"
        ? item.createdAt
        : typeof item?.created_at === "string"
        ? item.created_at
        : undefined,
  };
}

function buildMockTimeSlots(doctorId?: string): TimeSlot[] {
  const slotMap: Record<string, TimeSlot[]> = {
    "doc-1": [
      { id: "slot-0830", label: "8:30 AM - 9:00 AM", available: true, start: "08:30", end: "09:00" },
      { id: "slot-0900", label: "9:00 AM - 9:30 AM", available: true, start: "09:00", end: "09:30" },
      { id: "slot-0930", label: "9:30 AM - 10:00 AM", available: false, start: "09:30", end: "10:00" },
      { id: "slot-1030", label: "10:30 AM - 11:00 AM", available: true, start: "10:30", end: "11:00" },
      { id: "slot-1100", label: "11:00 AM - 11:30 AM", available: true, start: "11:00", end: "11:30" },
      { id: "slot-1330", label: "1:30 PM - 2:00 PM", available: true, start: "13:30", end: "14:00" },
      { id: "slot-1430", label: "2:30 PM - 3:00 PM", available: true, start: "14:30", end: "15:00" },
      { id: "slot-1600", label: "4:00 PM - 4:30 PM", available: true, start: "16:00", end: "16:30" },
    ],
    "doc-2": [
      { id: "slot-1000", label: "10:00 AM - 10:30 AM", available: true, start: "10:00", end: "10:30" },
      { id: "slot-1030", label: "10:30 AM - 11:00 AM", available: true, start: "10:30", end: "11:00" },
      { id: "slot-1100", label: "11:00 AM - 11:30 AM", available: true, start: "11:00", end: "11:30" },
      { id: "slot-1300", label: "1:00 PM - 1:30 PM", available: true, start: "13:00", end: "13:30" },
      { id: "slot-1530", label: "3:30 PM - 4:00 PM", available: true, start: "15:30", end: "16:00" },
    ],
    "doc-3": [
      { id: "slot-0900", label: "9:00 AM - 9:30 AM", available: true, start: "09:00", end: "09:30" },
      { id: "slot-1000", label: "10:00 AM - 10:30 AM", available: true, start: "10:00", end: "10:30" },
      { id: "slot-1400", label: "2:00 PM - 2:30 PM", available: true, start: "14:00", end: "14:30" },
      { id: "slot-1500", label: "3:00 PM - 3:30 PM", available: true, start: "15:00", end: "15:30" },
      { id: "slot-1700", label: "5:00 PM - 5:30 PM", available: true, start: "17:00", end: "17:30" },
    ],
  };

  return slotMap[doctorId ?? ""] ?? slotMap["doc-1"];
}

async function getMockAppointmentTypes(): Promise<AppointmentType[]> {
  await wait(200);

  return [
    { id: "general-checkup", title: "General Check Up", durationMinutes: 30 },
    { id: "follow-up", title: "Follow Up", durationMinutes: 20 },
    { id: "consultation", title: "Consultation", durationMinutes: 30 },
  ];
}

async function getMockDoctorsByType(
  _appointmentTypeId: string
): Promise<Doctor[]> {
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
      available: true,
      rating: 4.6,
      experience: "10 years exp",
      price: "$130/h",
      specialty: "Family Care",
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
  date: string
): Promise<ScheduleResponse> {
  await wait(200);

  const doctors = await getMockDoctorsByType("general-checkup");
  const doctor = doctors.find((item) => item.id === doctorId) ?? doctors[0];
  const availableDates = generateAvailableDates();
  const resolvedDate = date || availableDates[0] || "";

  return {
    doctor: {
      id: doctor.id,
      name: doctor.name,
      role: doctor.role,
    },
    date: resolvedDate,
    availableDates,
    timeSlots: buildMockTimeSlots(doctorId),
    version: 1,
  };
}


async function getMockMyBookings(): Promise<BookingConfirmation[]> {
  await wait(200);

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);

  const fallbackUpcoming: BookingConfirmation = {
    bookingId: "mock-upcoming-1",
    status: "confirmed",
    doctor: {
      id: "doc-1",
      name: "Dr. Jack Specs",
      role: "General Practitioner",
    },
    appointmentType: {
      id: "general-checkup",
      title: "General Check Up",
    },
    date: toDateKey(tomorrow),
    time: "10:30 AM - 11:00 AM",
    room: "Room 203 - Main Care Unit",
    createdAt: new Date().toISOString(),
  };

  const fallbackPast: BookingConfirmation = {
    bookingId: "mock-past-1",
    status: "completed",
    doctor: {
      id: "doc-2",
      name: "Dr. Emily Ross",
      role: "General Practitioner",
    },
    appointmentType: {
      id: "follow-up",
      title: "Follow Up",
    },
    date: toDateKey(lastWeek),
    time: "2:00 PM - 2:30 PM",
    room: "Room 105 - Main Care Unit",
    createdAt: lastWeek.toISOString(),
  };

  return [latestBooking, fallbackUpcoming, fallbackPast].filter(
    Boolean
  ) as BookingConfirmation[];
}

export async function getAppointmentTypes(): Promise<AppointmentType[]> {
  if (USE_MOCK_API) {
    return getMockAppointmentTypes();
  }

  const response = await request<
    AppointmentType[] | ApiListResponse<AppointmentType>
  >("/client/bookings/types");

  return unwrapList(response).map(normalizeAppointmentType);
}

export async function getDoctorsByType(
  appointmentTypeId: string
): Promise<Doctor[]> {
  if (USE_MOCK_API) {
    return getMockDoctorsByType(appointmentTypeId);
  }

  const query = new URLSearchParams({
    appointmentTypeId,
  }).toString();

  const response = await request<Doctor[] | ApiListResponse<Doctor>>(
    `/client/bookings/doctors?${query}`
  );

  return unwrapList(response).map(normalizeDoctor);
}

export async function getSchedule(
  doctorId: string,
  date: string
): Promise<ScheduleResponse> {
  if (USE_MOCK_API) {
    return getMockSchedule(doctorId, date);
  }

  const query = new URLSearchParams({ doctorId, date }).toString();

  const response = await request<
    ScheduleResponse | ApiItemResponse<ScheduleResponse>
  >(`/client/bookings/schedule?${query}`);

  return normalizeSchedule(unwrapItem(response));
}

export async function createBooking(
  input: CreateBookingInput
): Promise<BookingConfirmation> {
  if (!USE_MOCK_API) {
    const response = await request<
      BookingConfirmation | ApiItemResponse<BookingConfirmation>
    >("/client/bookings/", {
      method: "POST",
      body: {
        appointment_type_id: input.appointmentTypeId,
        doctor_id: input.doctorId,
        date: input.date,
        time_slot_id: input.timeSlotId,
      },
    });

    return normalizeBookingConfirmation(unwrapItem(response));
  }

  await wait(200);

  const doctors = await getMockDoctorsByType(input.appointmentTypeId);
  const doctor = doctors.find((item) => item.id === input.doctorId) ?? doctors[0];

  const types = await getMockAppointmentTypes();
  const appointmentType =
    types.find((item) => item.id === input.appointmentTypeId) ?? types[0];

  const schedule = await getMockSchedule(input.doctorId, input.date);
  const selectedSlot =
    schedule.timeSlots.find((slot) => slot.id === input.timeSlotId) ??
    schedule.timeSlots.find((slot) => slot.available) ??
    schedule.timeSlots[0];

  const booking: BookingConfirmation = {
    bookingId: `booking-${Date.now()}`,
    status: "confirmed",
    doctor: {
      id: doctor.id,
      name: doctor.name,
      role: doctor.role,
    },
    appointmentType: {
      id: appointmentType.id,
      title: appointmentType.title,
    },
    date: input.date,
    time: selectedSlot?.label ?? "",
    room: "Room 203 - Main Care Unit",
    createdAt: new Date().toISOString(),
  };

  latestBooking = booking;

  return booking;
}


export async function getMyBookings(): Promise<BookingConfirmation[]> {
  if (USE_MOCK_API) {
    return getMockMyBookings();
  }

  const response = await request<
    BookingConfirmation[] | ApiListResponse<BookingConfirmation>
  >("/client/bookings/my");

  return unwrapList(response).map(normalizeBookingConfirmation);
}

export async function getBookingConfirmation(
  bookingId: string
): Promise<BookingConfirmation> {
  if (!USE_MOCK_API) {
    const response = await request<
      BookingConfirmation | ApiItemResponse<BookingConfirmation>
    >(`/client/bookings/${bookingId}`);

    return normalizeBookingConfirmation(unwrapItem(response));
  }

  await wait(200);

  if (latestBooking?.bookingId === bookingId) {
    return latestBooking;
  }

  const bookings = await getMockMyBookings();
  const booking = bookings.find((item) => item.bookingId === bookingId);

  if (!booking) {
    throw new Error("Booking not found");
  }

  return booking;
}

export async function cancelBooking(
  bookingId: string
): Promise<{ bookingId: string; status: string }> {
  if (!USE_MOCK_API) {
    const response = await request<
      { bookingId: string; status: string } |
      ApiItemResponse<{ bookingId: string; status: string }>
    >(`/client/bookings/${bookingId}/cancel`, {
      method: "PATCH",
    });

    const data = unwrapItem(response);

    return {
      bookingId: String((data as any)?.bookingId ?? (data as any)?.booking_id ?? bookingId),
      status: String((data as any)?.status ?? "cancelled"),
    };
  }

  await wait(200);

  if (latestBooking?.bookingId === bookingId) {
    latestBooking = {
      ...latestBooking,
      status: "cancelled",
    };
  }

  return {
    bookingId,
    status: "cancelled",
  };
}
