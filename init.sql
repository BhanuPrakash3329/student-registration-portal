-- PostgreSQL 15+ schema for the Node/Express student registration portal.
-- The app also creates these tables on startup when its database role permits DDL.
-- Configure the initial admin with ADMIN_EMAIL / ADMIN_PASSWORD; never commit a default password.
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    dob DATE,
    gender VARCHAR(30),
    qualification VARCHAR(100),
    interests TEXT,
    class_name VARCHAR(100),
    subject VARCHAR(150),
    marks INTEGER,
    aadhar_filename VARCHAR(100),
    aadhar_data BYTEA,
    role VARCHAR(10) NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
    auth_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
