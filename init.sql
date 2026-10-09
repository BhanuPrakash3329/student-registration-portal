-- MySQL 8+ schema for the Node/Express student registration portal.
-- The application also creates these tables on startup.
-- Admin users are created from ADMIN_EMAIL / ADMIN_PASSWORD environment settings;
-- do not commit a default admin password.
CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    dob DATE NULL,
    gender VARCHAR(30) NULL,
    qualification VARCHAR(100) NULL,
    interests TEXT NULL,
    class_name VARCHAR(100) NULL,
    subject VARCHAR(150) NULL,
    marks INT NULL,
    aadhar_filename VARCHAR(100) NULL,
    aadhar_data MEDIUMBLOB NULL,
    role ENUM('admin', 'student') NOT NULL DEFAULT 'student',
    auth_version INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
