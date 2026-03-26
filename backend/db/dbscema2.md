-- =========================================
-- SPHERE CARE - MASTER DATABASE
-- PostgreSQL
-- Version with organizations table
-- =========================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------
-- updated_at trigger helper
-- -----------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------
-- organizations
-- One care center / organization
-- -----------------------------------------
CREATE TABLE organizations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unique_code VARCHAR(50) NOT NULL UNIQUE,
    organization_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(120),
    state VARCHAR(120),
    postal_code VARCHAR(30),
    country VARCHAR(120),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_unique_code ON organizations(unique_code);
CREATE INDEX idx_organizations_name ON organizations(organization_name);

CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------
-- admins
-- Admin accounts belonging to an organization
-- Multiple admins can belong to one center
-- -----------------------------------------
CREATE TABLE admins (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    unique_code VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_admins_role
        CHECK (role IN ('admin', 'super_admin', 'owner'))
);

CREATE INDEX idx_admins_organization_id ON admins(organization_id);
CREATE INDEX idx_admins_unique_code ON admins(unique_code);
CREATE INDEX idx_admins_email ON admins(email);

CREATE TRIGGER trg_admins_updated_at
BEFORE UPDATE ON admins
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------
-- users
-- Global system users
-- -----------------------------------------
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unique_code VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(30),
    profile_photo_url TEXT,
    global_role VARCHAR(50) NOT NULL,
    department VARCHAR(120),
    license_no VARCHAR(120),
    email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    push_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    sms_notifications BOOLEAN NOT NULL DEFAULT FALSE,
    dark_mode BOOLEAN NOT NULL DEFAULT FALSE,
    biometric_lock BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_global_role
        CHECK (global_role IN ('staff', 'client', 'family_contact', 'external_doctor', 'auditor')),
    CONSTRAINT chk_users_gender
        CHECK (gender IS NULL OR gender IN ('male', 'female', 'other', 'prefer_not_to_say'))
);

CREATE INDEX idx_users_unique_code ON users(unique_code);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_global_role ON users(global_role);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------
-- center_memberships
-- Membership between user and organization
-- -----------------------------------------
CREATE TABLE center_memberships (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    membership_role VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    joined_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_center_memberships_role
        CHECK (membership_role IN ('staff', 'client', 'family_contact', 'external_doctor')),
    CONSTRAINT chk_center_memberships_status
        CHECK (status IN ('pending', 'active', 'rejected', 'suspended', 'left'))
);

CREATE INDEX idx_center_memberships_user_id ON center_memberships(user_id);
CREATE INDEX idx_center_memberships_organization_id ON center_memberships(organization_id);
CREATE INDEX idx_center_memberships_status ON center_memberships(status);

CREATE UNIQUE INDEX uq_center_memberships_user_org_active
ON center_memberships(user_id, organization_id, status)
WHERE status IN ('pending', 'active');

CREATE TRIGGER trg_center_memberships_updated_at
BEFORE UPDATE ON center_memberships
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------
-- center_join_requests
-- Join or invite workflow
-- -----------------------------------------
CREATE TABLE center_join_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    membership_role VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    initiated_by VARCHAR(50) NOT NULL,
    request_message TEXT,
    rejection_reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    reviewed_by_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_center_join_requests_role
        CHECK (membership_role IN ('staff', 'client', 'family_contact', 'external_doctor')),
    CONSTRAINT chk_center_join_requests_status
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'left')),
    CONSTRAINT chk_center_join_requests_initiated_by
        CHECK (initiated_by IN ('user', 'admin'))
);

CREATE INDEX idx_center_join_requests_user_id ON center_join_requests(user_id);
CREATE INDEX idx_center_join_requests_organization_id ON center_join_requests(organization_id);
CREATE INDEX idx_center_join_requests_status ON center_join_requests(status);
CREATE INDEX idx_center_join_requests_requested_at ON center_join_requests(requested_at);
CREATE INDEX idx_center_join_requests_reviewed_by_admin_id ON center_join_requests(reviewed_by_admin_id);

CREATE TRIGGER trg_center_join_requests_updated_at
BEFORE UPDATE ON center_join_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------
-- user_sessions
-- Session/device tracking
-- -----------------------------------------
CREATE TABLE user_sessions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_name VARCHAR(255),
    device_type VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    last_active_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_revoked_at ON user_sessions(revoked_at);

CREATE TRIGGER trg_user_sessions_updated_at
BEFORE UPDATE ON user_sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------
-- audit_logs
-- Security and accountability
-- -----------------------------------------
CREATE TABLE audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    actor_admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
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

CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_actor_admin_id ON audit_logs(actor_admin_id);
CREATE INDEX idx_audit_logs_organization_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity_type_entity_id ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);