CREATE TABLE IF NOT EXISTS studio_meta (
    singleton TINYINT UNSIGNED PRIMARY KEY,
    schema_version SMALLINT UNSIGNED NOT NULL,
    source_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    username_key VARBINARY(256) NOT NULL UNIQUE,
    password_hash BINARY(32) NOT NULL,
    salt BINARY(16) NOT NULL,
    role VARCHAR(16) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS sessions (
    digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires BIGINT NOT NULL,
    INDEX session_expiry (expires),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS events (
    seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    draft LONGTEXT NOT NULL,
    published LONGTEXT NULL,
    owner_id BIGINT UNSIGNED NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS registrations (
    seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version BIGINT UNSIGNED NOT NULL,
    at VARCHAR(40) NOT NULL,
    fields_json LONGTEXT NOT NULL,
    values_json LONGTEXT NOT NULL,
    UNIQUE KEY registration_request (event_id,request_id),
    FOREIGN KEY (event_id) REFERENCES events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS registration_identities (
    event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    digest BINARY(32) NOT NULL,
    registration_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY(event_id,kind,digest),
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS event_visits (
    event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    visit_id BINARY(16) NOT NULL,
    visitor_digest BINARY(32) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    active_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    reached_last BOOLEAN NOT NULL DEFAULT FALSE,
    converted BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(event_id,visit_id),
    INDEX visits_period(started_at,event_id),
    INDEX visits_event_period(event_id,started_at),
    FOREIGN KEY (event_id) REFERENCES events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS member_state (
    user_id BIGINT UNSIGNED PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    pending BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS password_links (
    user_id BIGINT UNSIGNED PRIMARY KEY,
    digest BINARY(32) NOT NULL UNIQUE,
    kind VARCHAR(12) CHARACTER SET ascii NOT NULL,
    expires BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS member_logins (
    seq BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    ip VARCHAR(45) CHARACTER SET ascii NOT NULL,
    at DATETIME(3) NOT NULL,
    INDEX member_login_order(user_id,seq),
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS event_operations (
    seq BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_id BIGINT UNSIGNED NOT NULL,
    operation VARCHAR(12) CHARACTER SET ascii NOT NULL,
    version BIGINT UNSIGNED NOT NULL,
    changes JSON NOT NULL,
    at DATETIME(3) NOT NULL,
    INDEX event_operation_order(event_id,seq),
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE IF NOT EXISTS event_publications (
    event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    short_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    accepting BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    FOREIGN KEY (event_id) REFERENCES events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
