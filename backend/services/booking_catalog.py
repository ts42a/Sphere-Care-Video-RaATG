from datetime import datetime, timedelta

APPOINTMENT_TYPES = [
    {"id": "general-checkup", "title": "General Check Up", "duration_minutes": 30},
    {"id": "follow-up", "title": "Follow Up", "duration_minutes": 20},
    {"id": "consultation", "title": "Consultation", "duration_minutes": 30},
    {"id": "lab-test", "title": "Lab Test", "duration_minutes": 30},
    {"id": "review-med", "title": "Review Medication", "duration_minutes": 30},
    {"id": "vaccination", "title": "Vaccination", "duration_minutes": 30},
]

DOCTORS = [
    {
        "id": "doc-1",
        "name": "Dr. Jack Specs",
        "role": "General Practitioner",
        "available": True,
        "rating": 4.8,
        "experience": "8 years exp",
        "price": "$120/h",
        "specialty": "General Care",
        "appointment_type_ids": ["general-checkup", "follow-up", "consultation"],
        "room": "Room 203 - Main Care Unit",
        "working_days": [0, 1, 2, 3, 4],
        "slots": [
            ("08:30", "09:00"),
            ("09:00", "09:30"),
            ("09:30", "10:00"),
            ("10:30", "11:00"),
            ("11:00", "11:30"),
            ("13:30", "14:00"),
            ("14:30", "15:00"),
            ("16:00", "16:30"),
        ],
    },
    {
        "id": "doc-2",
        "name": "Dr. Emily Ross",
        "role": "General Practitioner",
        "available": True,
        "rating": 4.6,
        "experience": "10 years exp",
        "price": "$130/h",
        "specialty": "Family Care",
        "appointment_type_ids": ["general-checkup", "follow-up"],
        "room": "Room 205 - Main Care Unit",
        "working_days": [0, 1, 2, 3, 4],
        "slots": [
            ("10:00", "10:30"),
            ("10:30", "11:00"),
            ("11:00", "11:30"),
            ("13:00", "13:30"),
            ("15:30", "16:00"),
        ],
    },
    {
        "id": "doc-3",
        "name": "Dr. Michael Chen",
        "role": "General Practitioner",
        "available": True,
        "rating": 4.9,
        "experience": "12 years exp",
        "price": "$135/h",
        "specialty": "General Care",
        "appointment_type_ids": ["general-checkup", "follow-up", "consultation", "review-med"],
        "room": "Room 207 - Main Care Unit",
        "working_days": [0, 2, 4],
        "slots": [
            ("09:00", "09:30"),
            ("10:00", "10:30"),
            ("14:00", "14:30"),
            ("15:00", "15:30"),
            ("17:00", "17:30"),
        ],
    },
    {
        "id": "doc-4",
        "name": "Dr. Helen Cruz",
        "role": "General Practitioner",
        "available": False,
        "rating": 4.5,
        "experience": "9 years exp",
        "price": "$118/h",
        "specialty": "General Care",
        "appointment_type_ids": ["general-checkup", "lab-test", "vaccination"],
        "room": "Room 209 - Main Care Unit",
        "working_days": [],
        "slots": [],
    },
    {
        "id": "doc-5",
        "name": "Dr. Robert Kim",
        "role": "General Practitioner",
        "available": True,
        "rating": 4.7,
        "experience": "11 years exp",
        "price": "$128/h",
        "specialty": "General Care",
        "appointment_type_ids": ["general-checkup", "follow-up", "consultation"],
        "room": "Room 211 - Main Care Unit",
        "working_days": [1, 3],
        "slots": [
            ("09:30", "10:00"),
            ("10:30", "11:00"),
            ("13:00", "13:30"),
            ("14:00", "14:30"),
            ("15:00", "15:30"),
        ],
    },
]


def format_time_label(value: str):
    parsed = datetime.strptime(value, "%H:%M")
    hour = parsed.hour % 12 or 12
    minute = parsed.minute
    meridiem = "AM" if parsed.hour < 12 else "PM"
    return f"{hour}:{minute:02d} {meridiem}"


def make_slot(start: str, end: str):
    return {
        "id": f"slot-{start.replace(':', '')}",
        "label": f"{format_time_label(start)} - {format_time_label(end)}",
        "start": start,
        "end": end,
    }


def get_appointment_types():
    return APPOINTMENT_TYPES


def get_appointment_type_by_id(appointment_type_id: str):
    return next((item for item in APPOINTMENT_TYPES if item["id"] == appointment_type_id), None)


def get_doctors(appointment_type_id: str | None = None):
    if not appointment_type_id:
        return DOCTORS
    return [
        doctor for doctor in DOCTORS
        if appointment_type_id in doctor["appointment_type_ids"]
    ]


def get_doctor_by_id(doctor_id: str):
    return next((item for item in DOCTORS if item["id"] == doctor_id), None)


def get_slot_templates(doctor_id: str | None = None):
    doctor = get_doctor_by_id(doctor_id) if doctor_id else None
    slots = doctor.get("slots", []) if doctor else DOCTORS[0]["slots"]
    return [make_slot(start, end) for start, end in slots]


def get_slot_template_by_id(slot_id: str, doctor_id: str | None = None):
    return next((slot for slot in get_slot_templates(doctor_id) if slot["id"] == slot_id), None)


def get_available_dates(doctor_id: str | None = None, days_ahead: int = 28):
    today = datetime.now().date()
    dates: list[str] = []
    doctor = get_doctor_by_id(doctor_id) if doctor_id else None
    working_days = doctor.get("working_days", [0, 1, 2, 3, 4]) if doctor else [0, 1, 2, 3, 4]

    for i in range(1, days_ahead + 1):
        d = today + timedelta(days=i)
        if d.weekday() in working_days:
            dates.append(d.isoformat())

    return dates
