import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timedelta
from app.db.session import SessionLocal, engine
from app.db.base import Base
from app import models

models.Base.metadata.create_all(bind=engine)
db = SessionLocal()

def exists(model, **kwargs):
    return db.query(model).filter_by(**kwargs).first()


# RESIDENTS
RESIDENTS = [
    {"full_name": "Sarah Johnson",   "age": 78, "room": "105", "status": "monitoring", "ai_summary": "Mild back pain after exercise. BP slightly elevated, monitoring closely. Mood stable."},
    {"full_name": "Robert Martinez", "age": 82, "room": "203", "status": "stable",     "ai_summary": "Skipped lunch today. Appetite lower this week. Vitals normal, mood calm."},
    {"full_name": "Evelyn Brooks",   "age": 68, "room": "301", "status": "stable",     "ai_summary": "All vitals normal. Active in morning exercises. Positive mood throughout the day."},
    {"full_name": "George Patel",    "age": 74, "room": "202", "status": "monitoring", "ai_summary": "Frequent pain reports; under review. Sleep patterns irregular. Family notified."},
    {"full_name": "Hannah Li",       "age": 72, "room": "103", "status": "monitoring", "ai_summary": "Low mood noted; counselling set for tomorrow. Eating well, less social interaction."},
    {"full_name": "Dorothy Clarke",  "age": 82, "room": "106", "status": "stable",     "ai_summary": "Fatigue reported this morning. Resting now. Vitals stable. No urgent concerns."},
    {"full_name": "Patrick Ellis",   "age": 85, "room": "104", "status": "monitoring", "ai_summary": "Raised voice during meal; calm now. Staff monitoring behaviour. No fall risk detected."},
    {"full_name": "Lillian Adams",   "age": 86, "room": "201", "status": "stable",     "ai_summary": "Delayed medication intake this morning. Otherwise stable. Good appetite and engagement."},
]

def seed_residents():
    added = 0
    for r in RESIDENTS:
        if not exists(models.Resident, full_name=r["full_name"]):
            db.add(models.Resident(**r))
            added += 1
    db.commit()
    print(f"  Residents:     {added} added")

# FLAGS
FLAGS = [
    {
        "resident_name": "Hannah Li",      "resident_id": "RES005",
        "event_type": "Distress",    "description": "Low mood noted; follow-up set",
        "severity": "Medium", "source": "AI",    "status": "Pending Review",
        "ai_confidence": 82,  "video_timestamp": "00:01:45",
        "sev_desc": "Speech cue: 'I don't feel well' — Emotional distress indicator.",
        "transcript": "Staff: How are you feeling today, Hannah?\nHannah: Not great. I just feel sad.\n[Distress detected by AI system.]",
        "flagged_at": datetime.utcnow() - timedelta(hours=2),
    },
    {
        "resident_name": "George Patel",   "resident_id": "RES004",
        "event_type": "Pain",        "description": "Frequent pain reports; under review",
        "severity": "High",   "source": "AI",    "status": "Pending Review",
        "ai_confidence": 91,  "video_timestamp": "00:03:12",
        "sev_desc": "Verbal cue: 'My back hurts a lot' — Pain escalation detected.",
        "transcript": "Staff: How is your pain level today?\nGeorge: It's really bad, maybe 8 out of 10.\n[High pain level detected by AI system.]",
        "flagged_at": datetime.utcnow() - timedelta(hours=3),
    },
    {
        "resident_name": "Sarah Johnson",  "resident_id": "RES001",
        "event_type": "Pain",        "description": "Mild back pain after exercise",
        "severity": "Low",    "source": "AI",    "status": "Pending Review",
        "ai_confidence": 74,  "video_timestamp": "00:00:55",
        "sev_desc": "Movement pattern indicates mild discomfort post-exercise.",
        "transcript": "Staff: How did the exercise go?\nSarah: Good but my back is a little sore.\n[Mild pain indicator detected.]",
        "flagged_at": datetime.utcnow() - timedelta(hours=4),
    },
    {
        "resident_name": "Patrick Ellis",  "resident_id": "RES007",
        "event_type": "Agitation",   "description": "Raised voice during meal; calm now",
        "severity": "Low",    "source": "Staff", "status": "Resolved",
        "ai_confidence": None, "video_timestamp": "00:02:05",
        "sev_desc": "Voice tone elevated during meal time. Resident calmed after staff intervention.",
        "transcript": "Patrick: I don't want this food!\nStaff: Let's try something else.\n[Agitation resolved by staff.]",
        "flagged_at": datetime.utcnow() - timedelta(hours=5),
    },
    {
        "resident_name": "Hannah Li",      "resident_id": "RES005",
        "event_type": "Crying",      "description": "Soft crying detected for 2 minutes",
        "severity": "Medium", "source": "AI",    "status": "Open",
        "ai_confidence": 88,  "video_timestamp": "00:01:30",
        "sev_desc": "Audio pattern detected: soft crying for approximately 2 minutes.",
        "transcript": "AI System: Crying audio pattern detected.\nDuration: 2 minutes 14 seconds.\n[Staff notified automatically.]",
        "flagged_at": datetime.utcnow() - timedelta(hours=6),
    },
    {
        "resident_name": "Robert Martinez","resident_id": "RES002",
        "event_type": "Medication",  "description": "Skipped evening medication",
        "severity": "High",   "source": "Staff", "status": "Escalated",
        "ai_confidence": None, "video_timestamp": "00:00:00",
        "sev_desc": "Resident refused evening medication. Escalated to nurse on duty.",
        "transcript": "Staff: Time for your medication, Robert.\nRobert: I don't want it tonight.\n[Nurse notified, medication refusal logged.]",
        "flagged_at": datetime.utcnow() - timedelta(hours=8),
    },
]

FLAG_COMMENTS = {
    0: [
        {"author": "Sarah Mitchell", "body": "Spoke with Hannah briefly. She mentioned missing her family. Arranging a video call."},
    ],
    1: [
        {"author": "Dr. James Reid", "body": "Reviewed pain chart. Increasing pain relief dosage by 10mg. Monitor for 24hrs."},
        {"author": "Linda Pham",     "body": "George comfortable after medication adjustment. Will check again at 6pm."},
    ],
}

def seed_flags():
    added = 0
    flag_records = []
    for f in FLAGS:
        if not exists(models.Flag, resident_name=f["resident_name"], description=f["description"]):
            flag = models.Flag(**f)
            db.add(flag)
            db.flush()
            flag_records.append(flag)
            added += 1
        else:
            flag_records.append(None)
    db.commit()
    for idx, comments in FLAG_COMMENTS.items():
        flag = flag_records[idx]
        if flag:
            for cmt in comments:
                db.add(models.FlagComment(flag_id=flag.id, **cmt))
    db.commit()
    print(f"  Flags:         {added} added")

# RECORDS & AI INSIGHTS
RECORDS = [
    {"resident_name": "Margaret Chen",  "category": "Medication Administration", "record_type": "video",    "duration": "09:15", "notes": "Medication review and blood pressure recorded successfully.",         "recorded_at": "10/22/2025", "recorded_time": "09:15"},
    {"resident_name": "Alice Tan",       "category": "Family Video Call",         "record_type": "video",    "duration": "14:00", "notes": "Positive interaction recorded. No distress or agitation.",            "recorded_at": "10/22/2025", "recorded_time": "14:00"},
    {"resident_name": "Sharon Lim",      "category": "Vital Check",               "record_type": "video",    "duration": "09:45", "notes": "BP slightly elevated. Nurse notified for observation.",               "recorded_at": "10/22/2025", "recorded_time": "09:45"},
    {"resident_name": "Jason Ong",       "category": "Physical Therapy",          "record_type": "video",    "duration": "11:10", "notes": "Completed stretching exercises with assistance.",                    "recorded_at": "10/20/2025", "recorded_time": "11:10"},
    {"resident_name": "Robert Thompson", "category": "Mobility Exercise",         "record_type": "video",    "duration": "10:30", "notes": "Resident completed hallway walking routine. Detected mild fatigue.", "recorded_at": "10/20/2025", "recorded_time": "10:30"},
    {"resident_name": "Mrs Lee",         "category": "Cognitive Therapy Session", "record_type": "video",    "duration": "08:50", "notes": "Engaged in word association task. Mild memory hesitation noted.",    "recorded_at": "10/20/2025", "recorded_time": "08:50"},
    {"resident_name": "George Patel",    "category": "Care Assessment",           "record_type": "document", "duration": None,    "notes": "Quarterly assessment. Pain medication reviewed.",                   "recorded_at": "10/19/2025", "recorded_time": "09:30"},
    {"resident_name": "Hannah Li",       "category": "Wellness Check",            "record_type": "audio",    "duration": "05:20", "notes": "Low mood noted. Counselling arranged for tomorrow.",                 "recorded_at": "10/19/2025", "recorded_time": "13:00"},
]

AI_INSIGHTS = [
    {"resident_name": "Robert Thompson", "title": "Agitation Pattern Detected", "priority": "high", "body": "Robert Thompson has shown increased agitation during morning routines for 3 consecutive days. Consider adjusting care approach or timing."},
    {"resident_name": "",                "title": "Medication Reminder Missed",  "priority": "high", "body": "Routine medication was not marked as completed by 09:00 AM. Notify assigned nurse."},
    {"resident_name": "Margaret Chen",   "title": "Heart Rate Spike",            "priority": "mid",  "body": "Heart rate reached 108 BPM during morning exercise. Monitor if persistent."},
    {"resident_name": "Mrs Lee",         "title": "Sleep Disturbance Noted",     "priority": "mid",  "body": "Frequent movements detected between 2:00 AM and 4:00 AM. Possible discomfort or pain."},
    {"resident_name": "Robert Thompson", "title": "Cognitive Pause Observed",    "priority": "mid",  "body": "12-second pause in word recall task. May need follow-up cognitive test."},
    {"resident_name": "Jason Ong",       "title": "Positive Social Interaction", "priority": "low",  "body": "Resident engaged positively in group activity session. No agitation detected."},
    {"resident_name": "Alice Tan",       "title": "Appetite Improvement",        "priority": "low",  "body": "Finished full meal for 3 consecutive days. Current nutrition plan appears effective."},
    {"resident_name": "Sharon Lim",      "title": "BP Stabilising",              "priority": "low",  "body": "Blood pressure readings trending back to normal range after medication adjustment."},
]

def seed_records():
    added = 0
    for r in RECORDS:
        if not exists(models.Record, resident_name=r["resident_name"], category=r["category"], recorded_at=r["recorded_at"]):
            db.add(models.Record(**r))
            added += 1
    db.commit()
    print(f"  Records:       {added} added")

def seed_insights():
    added = 0
    for i in AI_INSIGHTS:
        if not exists(models.AiInsight, title=i["title"], resident_name=i["resident_name"]):
            db.add(models.AiInsight(**i))
            added += 1
    db.commit()
    print(f"  AI Insights:   {added} added")

# CONVERSATIONS & MESSAGES
CONVERSATIONS = [
    {"name": "Care Team \u2013 Floor 2",            "category": "team",     "last_message": "Perfect, I'll check on her in 10 minutes",               "unread_count": 3},
    {"name": "Sarah Chen",                           "category": "team",     "last_message": "Can you help me with Mrs. Johnson's medication schedule?", "unread_count": 1},
    {"name": "Resident Care: Dorothy Williams",      "category": "resident", "last_message": "Daily care report completed successfully.",               "unread_count": 0},
    {"name": "Night Shift Handover",                 "category": "team",     "last_message": "All residents sleeping peacefully. No incidents.",         "unread_count": 0},
    {"name": "Emergency Alerts",                     "category": "alerts",   "last_message": "Fire drill scheduled for tomorrow at 2 PM.",              "unread_count": 0},
]

MESSAGES = [
    (0, "Sarah Chen",   "Senior Carer", "Hi team! Mrs. Johnson in room 204 is asking for her afternoon medication. Can someone check on her?", "false"),
    (0, "Me",           "Senior Carer", "Perfect, I'll check on her in 10 minutes",                                                            "true"),
    (0, "Mike Roberts", "Nurse",        "Thanks! I've also updated her care plan with the new medication schedule.",                            "false"),
    (1, "Sarah Chen",   "Senior Carer", "Can you help me with Mrs. Johnson's medication schedule?",                                             "false"),
    (2, "Linda Pham",   "Carer",        "Daily care report for Dorothy Williams completed. All vitals stable.",                                  "false"),
    (2, "Me",           "Senior Carer", "Thank you! I've reviewed the report.",                                                                 "true"),
    (3, "Night Team",   "Carer",        "All residents sleeping peacefully. No incidents to report.",                                           "false"),
    (4, "System",       "Admin",        "Fire drill scheduled for tomorrow at 2 PM. All staff please be prepared.",                             "false"),
]

def seed_messages():
    added_c = 0
    conv_records = []
    for cv in CONVERSATIONS:
        if not exists(models.Conversation, name=cv["name"]):
            c = models.Conversation(
                name=cv["name"], category=cv["category"],
                last_message=cv["last_message"],
                last_message_at=datetime.utcnow(),
                unread_count=cv["unread_count"],
            )
            db.add(c)
            db.flush()
            conv_records.append(c)
            added_c += 1
        else:
            conv_records.append(exists(models.Conversation, name=cv["name"]))
    db.commit()

    added_m = 0
    for (ci, sender_name, sender_role, content, is_self) in MESSAGES:
        conv = conv_records[ci]
        if conv and not exists(models.Message, conversation_id=conv.id, content=content):
            db.add(models.Message(
                conversation_id=conv.id,
                sender_name=sender_name, sender_role=sender_role,
                content=content, is_self=is_self,
            ))
            added_m += 1
    db.commit()
    print(f"  Conversations: {added_c} added,  Messages: {added_m} added")


# STAFF
STAFF = [
    {"staff_id": "ST-4829", "full_name": "Sarah Johnson",  "shift_time": "7:00 AM - 3:00 PM",  "assigned_unit": "ICU Ward",    "status": "active",   "role": "Senior Carer"},
    {"staff_id": "ST-3746", "full_name": "Michael Chen",   "shift_time": "3:00 PM - 11:00 PM", "assigned_unit": "Emergency",   "status": "on_leave", "role": "Nurse"},
    {"staff_id": "ST-5920", "full_name": "Emma Rodriguez", "shift_time": "11:00 PM - 7:00 AM", "assigned_unit": "General Ward","status": "pending",  "role": "Carer"},
    {"staff_id": "ST-1038", "full_name": "David Kim",      "shift_time": "7:00 AM - 3:00 PM",  "assigned_unit": "Pediatrics",  "status": "active",   "role": "Doctor"},
    {"staff_id": "ST-2241", "full_name": "Linda Pham",     "shift_time": "7:00 AM - 3:00 PM",  "assigned_unit": "Geriatrics",  "status": "active",   "role": "Carer"},
    {"staff_id": "ST-6610", "full_name": "James Carter",   "shift_time": "3:00 PM - 11:00 PM", "assigned_unit": "Neurology",   "status": "active",   "role": "Nurse"},
]

def seed_staff():
    added = 0
    for s in STAFF:
        if not exists(models.Staff, staff_id=s["staff_id"]):
            db.add(models.Staff(**s))
            added += 1
    db.commit()
    print(f"  Staff:         {added} added")

# ALERTS
ALERTS = [
    {"level": "warning",  "title": "Staff Shortage Warning", "message": "ICU Ward requires additional coverage for night shift.", "is_read": "false"},
    {"level": "critical", "title": "Critical Task Overdue",  "message": "Equipment maintenance check pending for 2 days.",        "is_read": "false"},
    {"level": "info",     "title": "System Update",          "message": "New staff scheduling features now available.",           "is_read": "false"},
]

def seed_alerts():
    added = 0
    for a in ALERTS:
        if not exists(models.Alert, title=a["title"]):
            db.add(models.Alert(**a))
            added += 1
    db.commit()
    print(f"  Alerts:        {added} added")


# CAMERAS  (Recording Console)
CAMERAS = [
    {"title": "Room 101 \u2014 Main View", "resident_name": "Sarah Johnson",   "floor": "Floor 1", "status": "live",    "alert": "fine",     "description": "Resident resting. No activity detected."},
    {"title": "Room 103 \u2014 Main View", "resident_name": "Hannah Li",       "floor": "Floor 1", "status": "live",    "alert": "critical", "description": "Possible distress detected. Crying audio pattern."},
    {"title": "Room 104 \u2014 Main View", "resident_name": "Patrick Ellis",   "floor": "Floor 1", "status": "live",    "alert": "fine",     "description": "Resident calm after meal. All clear."},
    {"title": "Room 105 \u2014 Main View", "resident_name": "Evelyn Brooks",   "floor": "Floor 1", "status": "live",    "alert": "fine",     "description": "Resident active. Morning exercises in progress."},
    {"title": "Room 202 \u2014 Main View", "resident_name": "George Patel",    "floor": "Floor 2", "status": "live",    "alert": "critical", "description": "Pain indicators detected. Nurse alerted."},
    {"title": "Room 203 \u2014 Main View", "resident_name": "Robert Martinez", "floor": "Floor 2", "status": "live",    "alert": "fine",     "description": "Resident eating lunch. Appetite slightly low."},
    {"title": "Floor 2 \u2014 Corridor",   "resident_name": None,              "floor": "Floor 2", "status": "live",    "alert": "fine",     "description": "No movement detected. All clear."},
    {"title": "Room 301 \u2014 Main View", "resident_name": "Dorothy Clarke",  "floor": "Floor 3", "status": "offline", "alert": "none",     "description": "Camera offline. Maintenance scheduled."},
]

CAMERA_ALERTS = [
    (1, {"alert_type": "critical", "icon": "sound",  "title": "Crying Detected",        "description": "Soft crying audio detected for 2 minutes 14 seconds. Staff notified.", "resolved": False}),
    (4, {"alert_type": "critical", "icon": "person", "title": "Pain Indicator Detected", "description": "Resident verbal pain cue detected. Nurse on duty alerted.",           "resolved": False}),
    (6, {"alert_type": "warning",  "icon": "motion", "title": "Unusual Motion Pattern",  "description": "Slow irregular movement detected in corridor at 02:15 AM.",           "resolved": True}),
]

def seed_cameras():
    added = 0
    cam_records = []
    for cam in CAMERAS:
        if not exists(models.Camera, title=cam["title"]):
            c = models.Camera(**cam)
            db.add(c)
            db.flush()
            cam_records.append(c)
            added += 1
        else:
            cam_records.append(exists(models.Camera, title=cam["title"]))
    db.commit()

    added_a = 0
    for (ci, alert_data) in CAMERA_ALERTS:
        cam = cam_records[ci]
        if cam and not exists(models.CameraAlert, camera_id=cam.id, title=alert_data["title"]):
            db.add(models.CameraAlert(camera_id=cam.id, **alert_data))
            added_a += 1
    db.commit()
    print(f"  Cameras:       {added} added,  Camera Alerts: {added_a} added")
# MAIN
if __name__ == "__main__":
    print("\n Seeding Sphere Care database...\n")
    try:
        seed_residents()
        seed_flags()
        seed_records()
        seed_insights()
        seed_messages()
        seed_staff()
        seed_alerts()
        seed_cameras()
        print("\n Done! All pages now have real data. Restart your FastAPI server.\n")
    except Exception as e:
        db.rollback()
        print(f"\n Seed failed: {e}\n")
        raise
    finally:
        db.close()
