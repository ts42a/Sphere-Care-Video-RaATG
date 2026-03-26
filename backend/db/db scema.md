-- =========================================================
-- SPHERE CARE - PER-CENTER DATABASE SCHEMA
-- PostgreSQL
-- One database per care center
-- Note:
-- - user_id links to master.users.id are logical only
-- - no cross-database foreign keys are used
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------
-- UPDATED_AT TRIGGER HELPER
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------
-- RESIDENTS
-- ---------------------------------------------------------
CREATE TABLE residents (
    id BIGSERIAL PRIMARY KEY,
    unique_code VARCHAR(50) NOT NULL UNIQUE,
    admin_id BIGINT NOT NULL,
    client_user_id BIGINT,         -- logical link -> master.users.id
    created_by_user_id BIGINT,     -- logical link -> master.users.id
    created_by_name VARCHAR(255),
    created_by_role VARCHAR(80),
    full_name VARCHAR(255) NOT NULL,
    preferred_name VARCHAR(255),
    age INTEGER,
    date_of_birth DATE,
    gender VARCHAR(30),
    room VARCHAR(50),
    bed_no VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    ai_summary TEXT,
    admission_date DATE,
    discharge_date DATE,
    care_level VARCHAR(100),
    primary_diagnosis TEXT,
    mobility_status VARCHAR(100),
    consent_status VARCHAR(50),
    guardian_required BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT,             -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_residents_status CHECK (
        status IN ('active', 'monitoring', 'discharged', 'archived')
    ),
    CONSTRAINT chk_residents_age CHECK (
        age IS NULL OR age >= 0
    ),
    CONSTRAINT chk_residents_gender CHECK (
        gender IS NULL OR gender IN ('male', 'female', 'other', 'prefer_not_to_say')
    )
);

CREATE INDEX idx_residents_admin_id ON residents(admin_id);
CREATE INDEX idx_residents_client_user_id ON residents(client_user_id);
CREATE INDEX idx_residents_status ON residents(status);

CREATE TRIGGER trg_residents_updated_at
BEFORE UPDATE ON residents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- RESIDENT MEDICAL PROFILES
-- ---------------------------------------------------------
CREATE TABLE resident_medical_profiles (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    blood_group VARCHAR(10),
    allergies TEXT,
    chronic_conditions TEXT,
    medications TEXT,
    primary_doctor VARCHAR(255),
    hospital_preference VARCHAR(255),
    mobility_notes TEXT,
    dietary_requirements TEXT,
    mental_health_notes TEXT,
    fall_risk_level VARCHAR(50),
    dementia_status VARCHAR(100),
    communication_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resident_medical_profiles_admin_id ON resident_medical_profiles(admin_id);
CREATE UNIQUE INDEX uq_resident_medical_profiles_resident_id
ON resident_medical_profiles(resident_id);

CREATE TRIGGER trg_resident_medical_profiles_updated_at
BEFORE UPDATE ON resident_medical_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- RESIDENT FAMILY MEMBERS
-- ---------------------------------------------------------
CREATE TABLE resident_family_members (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    user_id BIGINT,                -- logical link -> master.users.id
    full_name VARCHAR(255) NOT NULL,
    relationship VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    alternate_phone VARCHAR(50),
    email VARCHAR(255),
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(120),
    state VARCHAR(120),
    postal_code VARCHAR(30),
    country VARCHAR(120),
    is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    can_view_records BOOLEAN NOT NULL DEFAULT FALSE,
    can_receive_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    can_join_video_calls BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resident_family_members_admin_id ON resident_family_members(admin_id);
CREATE INDEX idx_resident_family_members_resident_id ON resident_family_members(resident_id);
CREATE INDEX idx_resident_family_members_user_id ON resident_family_members(user_id);

CREATE TRIGGER trg_resident_family_members_updated_at
BEFORE UPDATE ON resident_family_members
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- RESIDENT GUARDIANS
-- ---------------------------------------------------------
CREATE TABLE resident_guardians (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    user_id BIGINT,                -- logical link -> master.users.id
    full_name VARCHAR(255) NOT NULL,
    relationship VARCHAR(100),
    guardian_type VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    alternate_phone VARCHAR(50),
    email VARCHAR(255),
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(120),
    state VARCHAR(120),
    postal_code VARCHAR(30),
    country VARCHAR(120),
    legal_document_url TEXT,
    consent_authority BOOLEAN NOT NULL DEFAULT FALSE,
    medical_decision_authority BOOLEAN NOT NULL DEFAULT FALSE,
    financial_decision_authority BOOLEAN NOT NULL DEFAULT FALSE,
    is_primary_guardian BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_resident_guardians_type CHECK (
        guardian_type IN ('legal_guardian', 'power_of_attorney', 'next_of_kin', 'responsible_person', 'medical_guardian')
    )
);

CREATE INDEX idx_resident_guardians_admin_id ON resident_guardians(admin_id);
CREATE INDEX idx_resident_guardians_resident_id ON resident_guardians(resident_id);
CREATE INDEX idx_resident_guardians_user_id ON resident_guardians(user_id);

CREATE TRIGGER trg_resident_guardians_updated_at
BEFORE UPDATE ON resident_guardians
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- RESIDENT EMERGENCY CONTACTS
-- ---------------------------------------------------------
CREATE TABLE resident_emergency_contacts (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    relationship VARCHAR(100),
    phone VARCHAR(50) NOT NULL,
    alternate_phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    priority_order INTEGER NOT NULL DEFAULT 1,
    can_make_decisions BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_resident_emergency_contacts_priority_order CHECK (priority_order > 0)
);

CREATE INDEX idx_resident_emergency_contacts_admin_id ON resident_emergency_contacts(admin_id);
CREATE INDEX idx_resident_emergency_contacts_resident_id ON resident_emergency_contacts(resident_id);

CREATE TRIGGER trg_resident_emergency_contacts_updated_at
BEFORE UPDATE ON resident_emergency_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- STAFF
-- ---------------------------------------------------------
CREATE TABLE staff (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL UNIQUE, -- logical link -> master.users.id
    staff_code VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(80) NOT NULL,
    department VARCHAR(120),
    shift_start TIME,
    shift_end TIME,
    assigned_unit VARCHAR(120),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    approval_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    hire_date DATE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT,              -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_staff_status CHECK (
        status IN ('active', 'on_leave', 'inactive')
    ),
    CONSTRAINT chk_staff_approval_status CHECK (
        approval_status IN ('pending', 'approved', 'rejected')
    )
);

CREATE INDEX idx_staff_admin_id ON staff(admin_id);
CREATE INDEX idx_staff_user_id ON staff(user_id);
CREATE INDEX idx_staff_role ON staff(role);

CREATE TRIGGER trg_staff_updated_at
BEFORE UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- RESIDENT STAFF ASSIGNMENTS
-- ---------------------------------------------------------
CREATE TABLE resident_staff_assignments (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    staff_id BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    assignment_role VARCHAR(100) NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resident_staff_assignments_admin_id ON resident_staff_assignments(admin_id);
CREATE INDEX idx_resident_staff_assignments_resident_id ON resident_staff_assignments(resident_id);
CREATE INDEX idx_resident_staff_assignments_staff_id ON resident_staff_assignments(staff_id);

CREATE TRIGGER trg_resident_staff_assignments_updated_at
BEFORE UPDATE ON resident_staff_assignments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CAMERAS
-- ---------------------------------------------------------
CREATE TABLE cameras (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    resident_id BIGINT REFERENCES residents(id) ON DELETE SET NULL,
    resident_name VARCHAR(255),
    floor VARCHAR(50),
    room VARCHAR(50),
    location_note VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    stream_status VARCHAR(50) NOT NULL DEFAULT 'offline',
    stream_url TEXT,
    thumbnail_url TEXT,
    description TEXT,
    installed_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_cameras_status CHECK (
        status IN ('active', 'inactive', 'maintenance')
    ),
    CONSTRAINT chk_cameras_stream_status CHECK (
        stream_status IN ('online', 'offline', 'unstable')
    )
);

CREATE INDEX idx_cameras_admin_id ON cameras(admin_id);
CREATE INDEX idx_cameras_resident_id ON cameras(resident_id);

CREATE TRIGGER trg_cameras_updated_at
BEFORE UPDATE ON cameras
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CAMERA ALERTS
-- ---------------------------------------------------------
CREATE TABLE camera_alerts (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    camera_id BIGINT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    resident_id BIGINT REFERENCES residents(id) ON DELETE SET NULL,
    alert_type VARCHAR(100) NOT NULL,
    severity VARCHAR(30) NOT NULL,
    icon VARCHAR(100),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    snapshot_url TEXT,
    video_timestamp VARCHAR(100),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by BIGINT,             -- logical link -> master.users.id
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_camera_alerts_severity CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    )
);

CREATE INDEX idx_camera_alerts_admin_id ON camera_alerts(admin_id);
CREATE INDEX idx_camera_alerts_camera_id ON camera_alerts(camera_id);
CREATE INDEX idx_camera_alerts_resident_id ON camera_alerts(resident_id);

CREATE TRIGGER trg_camera_alerts_updated_at
BEFORE UPDATE ON camera_alerts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- BOOKINGS
-- ---------------------------------------------------------
CREATE TABLE bookings (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    doctor_name VARCHAR(255) NOT NULL,
    doctor_specialty VARCHAR(120),
    booking_type VARCHAR(120) NOT NULL,
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    location VARCHAR(255),
    notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'requested',
    created_by BIGINT,              -- logical link -> master.users.id
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT,              -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_bookings_status CHECK (
        status IN ('requested', 'confirmed', 'completed', 'cancelled', 'missed')
    )
);

CREATE INDEX idx_bookings_admin_id ON bookings(admin_id);
CREATE INDEX idx_bookings_resident_id ON bookings(resident_id);
CREATE INDEX idx_bookings_appointment_date ON bookings(appointment_date);

CREATE TRIGGER trg_bookings_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CARE TASKS
-- ---------------------------------------------------------
CREATE TABLE care_tasks (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    assigned_staff_id BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    task_type VARCHAR(100) NOT NULL,
    priority VARCHAR(30) NOT NULL DEFAULT 'medium',
    due_date DATE,
    due_time TIME,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    completed_at TIMESTAMPTZ,
    completed_by BIGINT,            -- logical link -> master.users.id
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_care_tasks_task_type CHECK (
        task_type IN ('medication', 'meal_support', 'hygiene_support', 'wellness_check', 'mobility_assist', 'doctor_followup')
    ),
    CONSTRAINT chk_care_tasks_priority CHECK (
        priority IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT chk_care_tasks_status CHECK (
        status IN ('pending', 'in_progress', 'completed', 'missed', 'cancelled')
    )
);

CREATE INDEX idx_care_tasks_admin_id ON care_tasks(admin_id);
CREATE INDEX idx_care_tasks_resident_id ON care_tasks(resident_id);
CREATE INDEX idx_care_tasks_assigned_staff_id ON care_tasks(assigned_staff_id);
CREATE INDEX idx_care_tasks_due_date ON care_tasks(due_date);

CREATE TRIGGER trg_care_tasks_updated_at
BEFORE UPDATE ON care_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- FLAGS
-- ---------------------------------------------------------
CREATE TABLE flags (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT REFERENCES residents(id) ON DELETE SET NULL,
    resident_name VARCHAR(255),
    camera_id BIGINT REFERENCES cameras(id) ON DELETE SET NULL,
    event_type VARCHAR(120) NOT NULL,
    description TEXT,
    severity VARCHAR(30) NOT NULL,
    source VARCHAR(30) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    sev_desc TEXT,
    transcript TEXT,
    video_timestamp VARCHAR(100),
    ai_confidence NUMERIC(5,2),
    flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_by BIGINT,              -- logical link -> master.users.id
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT,              -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_flags_severity CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT chk_flags_source CHECK (
        source IN ('ai', 'manual', 'hybrid')
    ),
    CONSTRAINT chk_flags_status CHECK (
        status IN ('open', 'pending_review', 'reviewed', 'resolved', 'escalated')
    ),
    CONSTRAINT chk_flags_ai_confidence CHECK (
        ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 100)
    )
);

CREATE INDEX idx_flags_admin_id ON flags(admin_id);
CREATE INDEX idx_flags_resident_id ON flags(resident_id);
CREATE INDEX idx_flags_camera_id ON flags(camera_id);
CREATE INDEX idx_flags_status ON flags(status);

CREATE TRIGGER trg_flags_updated_at
BEFORE UPDATE ON flags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- FLAG COMMENTS
-- ---------------------------------------------------------
CREATE TABLE flag_comments (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    flag_id BIGINT NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
    author_name VARCHAR(255) NOT NULL,
    author_user_id BIGINT,          -- logical link -> master.users.id
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flag_comments_admin_id ON flag_comments(admin_id);
CREATE INDEX idx_flag_comments_flag_id ON flag_comments(flag_id);

CREATE TRIGGER trg_flag_comments_updated_at
BEFORE UPDATE ON flag_comments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- RECORDS
-- ---------------------------------------------------------
CREATE TABLE records (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT REFERENCES residents(id) ON DELETE SET NULL,
    resident_name VARCHAR(255),
    category VARCHAR(120) NOT NULL,
    record_type VARCHAR(50) NOT NULL,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255),
    mime_type VARCHAR(120),
    file_size BIGINT,
    thumbnail_url TEXT,
    duration INTEGER,
    transcript_text TEXT,
    ai_summary TEXT,
    notes TEXT,
    recorded_at TIMESTAMPTZ,
    created_by BIGINT,              -- logical link -> master.users.id
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT,              -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_records_type CHECK (
        record_type IN ('video', 'transcript', 'pdf', 'image', 'audio', 'document')
    ),
    CONSTRAINT chk_records_file_size CHECK (
        file_size IS NULL OR file_size >= 0
    ),
    CONSTRAINT chk_records_duration CHECK (
        duration IS NULL OR duration >= 0
    )
);

CREATE INDEX idx_records_admin_id ON records(admin_id);
CREATE INDEX idx_records_resident_id ON records(resident_id);
CREATE INDEX idx_records_recorded_at ON records(recorded_at);

CREATE TRIGGER trg_records_updated_at
BEFORE UPDATE ON records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CONSENT DOCUMENTS
-- ---------------------------------------------------------
CREATE TABLE consent_documents (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    guardian_id BIGINT REFERENCES resident_guardians(id) ON DELETE SET NULL,
    document_type VARCHAR(100) NOT NULL,
    file_url TEXT NOT NULL,
    signed_at TIMESTAMPTZ,
    expiry_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    uploaded_by BIGINT,             -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_consent_documents_type CHECK (
        document_type IN ('medical_consent', 'camera_consent', 'data_sharing_consent', 'treatment_approval', 'guardian_authority')
    ),
    CONSTRAINT chk_consent_documents_status CHECK (
        status IN ('active', 'expired', 'revoked', 'pending')
    )
);

CREATE INDEX idx_consent_documents_admin_id ON consent_documents(admin_id);
CREATE INDEX idx_consent_documents_resident_id ON consent_documents(resident_id);
CREATE INDEX idx_consent_documents_guardian_id ON consent_documents(guardian_id);

CREATE TRIGGER trg_consent_documents_updated_at
BEFORE UPDATE ON consent_documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- AI INSIGHTS
-- ---------------------------------------------------------
CREATE TABLE ai_insights (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    resident_id BIGINT REFERENCES residents(id) ON DELETE SET NULL,
    resident_name VARCHAR(255),
    related_record_id BIGINT REFERENCES records(id) ON DELETE SET NULL,
    related_flag_id BIGINT REFERENCES flags(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    priority VARCHAR(30) NOT NULL DEFAULT 'medium',
    is_new BOOLEAN NOT NULL DEFAULT TRUE,
    generated_by_model VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ai_insights_category CHECK (
        category IN ('behaviour', 'sleep', 'medication', 'mobility', 'mood', 'communication')
    ),
    CONSTRAINT chk_ai_insights_priority CHECK (
        priority IN ('low', 'medium', 'high', 'critical')
    )
);

CREATE INDEX idx_ai_insights_admin_id ON ai_insights(admin_id);
CREATE INDEX idx_ai_insights_resident_id ON ai_insights(resident_id);

CREATE TRIGGER trg_ai_insights_updated_at
BEFORE UPDATE ON ai_insights
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CONVERSATIONS
-- ---------------------------------------------------------
CREATE TABLE conversations (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'direct',
    created_by BIGINT,              -- logical link -> master.users.id
    last_message TEXT,
    last_message_at TIMESTAMPTZ,
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_conversations_category CHECK (
        category IN ('direct', 'group', 'resident_care', 'clinical', 'admin')
    ),
    CONSTRAINT chk_conversations_unread_count CHECK (unread_count >= 0)
);

CREATE INDEX idx_conversations_admin_id ON conversations(admin_id);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at);

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CONVERSATION PARTICIPANTS
-- ---------------------------------------------------------
CREATE TABLE conversation_participants (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id BIGINT,                 -- logical link -> master.users.id
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(80),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_participants_conversation_id ON conversation_participants(conversation_id);
CREATE INDEX idx_conversation_participants_user_id ON conversation_participants(user_id);

CREATE UNIQUE INDEX uq_conversation_participants_conversation_user
ON conversation_participants(conversation_id, user_id)
WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------
-- MESSAGES
-- ---------------------------------------------------------
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id BIGINT,          -- logical link -> master.users.id
    sender_name VARCHAR(255) NOT NULL,
    sender_role VARCHAR(80),
    content TEXT NOT NULL,
    message_type VARCHAR(30) NOT NULL DEFAULT 'text',
    is_self BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_messages_type CHECK (
        message_type IN ('text', 'image', 'file', 'system')
    )
);

CREATE INDEX idx_messages_admin_id ON messages(admin_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sender_user_id ON messages(sender_user_id);

CREATE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- ATTACHMENTS
-- ---------------------------------------------------------
CREATE TABLE attachments (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT NOT NULL,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255),
    mime_type VARCHAR(120),
    file_size BIGINT,
    uploaded_by BIGINT,             -- logical link -> master.users.id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_attachments_entity_type CHECK (
        entity_type IN ('message', 'flag', 'record', 'booking', 'consent_document')
    ),
    CONSTRAINT chk_attachments_file_size CHECK (
        file_size IS NULL OR file_size >= 0
    )
);

CREATE INDEX idx_attachments_admin_id ON attachments(admin_id);
CREATE INDEX idx_attachments_entity_type_entity_id ON attachments(entity_type, entity_id);

-- ---------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------
CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    related_entity_type VARCHAR(80),
    related_entity_id BIGINT,
    is_priority BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_admin_id ON notifications(admin_id);

CREATE TRIGGER trg_notifications_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- NOTIFICATION RECIPIENTS
-- ---------------------------------------------------------
CREATE TABLE notification_recipients (
    id BIGSERIAL PRIMARY KEY,
    notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id BIGINT,                 -- logical link -> master.users.id
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_recipients_notification_id ON notification_recipients(notification_id);
CREATE INDEX idx_notification_recipients_user_id ON notification_recipients(user_id);

CREATE UNIQUE INDEX uq_notification_recipients_notification_user
ON notification_recipients(notification_id, user_id)
WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------
-- ALERTS
-- ---------------------------------------------------------
CREATE TABLE alerts (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    level VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    source VARCHAR(50) NOT NULL,
    related_entity_type VARCHAR(80),
    related_entity_id BIGINT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_alerts_level CHECK (
        level IN ('info', 'warning', 'high', 'critical')
    ),
    CONSTRAINT chk_alerts_source CHECK (
        source IN ('system', 'ai', 'camera', 'schedule', 'compliance')
    )
);

CREATE INDEX idx_alerts_admin_id ON alerts(admin_id);
CREATE INDEX idx_alerts_level ON alerts(level);

CREATE TRIGGER trg_alerts_updated_at
BEFORE UPDATE ON alerts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------
-- CENTER AUDIT LOGS
-- ---------------------------------------------------------
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    actor_user_id BIGINT,           -- logical link -> master.users.id
    actor_name VARCHAR(255),
    actor_role VARCHAR(80),
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(120) NOT NULL,
    entity_id BIGINT,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_center_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX idx_center_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_center_audit_logs_entity_type_entity_id ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_center_audit_logs_created_at ON audit_logs(created_at);