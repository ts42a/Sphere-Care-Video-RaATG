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
    },
]

SLOT_TEMPLATES = [
    {"id": "slot-0900", "label": "9:00 AM - 9:30 AM", "start": "09:00", "end": "09:30"},
    {"id": "slot-0930", "label": "9:30 AM - 10:00 AM", "start": "09:30", "end": "10:00"},
    {"id": "slot-1030", "label": "10:30 AM - 11:00 AM", "start": "10:30", "end": "11:00"},
    {"id": "slot-1100", "label": "11:00 AM - 11:30 AM", "start": "11:00", "end": "11:30"},
]


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


def get_slot_templates():
    return SLOT_TEMPLATES


def get_slot_template_by_id(slot_id: str):
    return next((slot for slot in SLOT_TEMPLATES if slot["id"] == slot_id), None)


def get_available_dates(days_ahead: int = 28):
    today = datetime.now().date()
    dates: list[str] = []

    for i in range(1, days_ahead + 1):
        d = today + timedelta(days=i)
        if d.weekday() < 5:
            dates.append(d.isoformat())

    return dates