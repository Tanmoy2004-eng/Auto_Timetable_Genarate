PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'theory' CHECK (type IN ('theory','lab','both')),
  max_periods_per_day INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'classroom' CHECK (type IN ('classroom','lab')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'theory' CHECK (type IN ('theory','lab')),
  periods_per_week INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

-- which subject a batch studies and who teaches it for that batch
CREATE TABLE IF NOT EXISTS batch_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  UNIQUE (batch_id, subject_id)
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  days TEXT NOT NULL DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
  periods_per_day INTEGER NOT NULL DEFAULT 7,
  start_time TEXT NOT NULL DEFAULT '09:00',
  period_minutes INTEGER NOT NULL DEFAULT 50,
  lunch_after INTEGER NOT NULL DEFAULT 4,
  lunch_minutes INTEGER NOT NULL DEFAULT 40,
  lab_block INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS timetables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timetable_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timetable_id INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  period INTEGER NOT NULL,
  span INTEGER NOT NULL DEFAULT 1,
  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entries_tt ON timetable_entries(timetable_id);
