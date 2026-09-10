-- TB Smart Study Planner normalized Postgres schema.
-- IDs stay TEXT so existing app.js identifiers remain unchanged.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  onboarded BOOLEAN NOT NULL DEFAULT FALSE,
  profile_name TEXT NOT NULL,
  profile_grade TEXT NOT NULL DEFAULT '',
  profile_goal TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  availability_start TIME NOT NULL DEFAULT '15:00',
  availability_end TIME NOT NULL DEFAULT '21:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminders BOOLEAN NOT NULL DEFAULT TRUE,
  coach BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS availability_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  PRIMARY KEY (user_id, weekday)
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'custom',
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mastery NUMERIC(5,2) NOT NULL DEFAULT 0,
  quiz_before NUMERIC(5,2),
  quiz_after NUMERIC(5,2),
  quiz_retention NUMERIC(5,2)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  deadline DATE NOT NULL,
  minutes INTEGER NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS fixed_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at TIME,
  ends_at TIME,
  schedule_type TEXT NOT NULL,
  flexible BOOLEAN NOT NULL DEFAULT FALSE,
  replacement_change_id TEXT
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  minutes INTEGER NOT NULL,
  understanding SMALLINT,
  status TEXT NOT NULL,
  study_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS review_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  due DATE NOT NULL,
  interval_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  note_id TEXT
);

CREATE TABLE IF NOT EXISTS study_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  topic_name TEXT NOT NULL,
  note_text TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  understanding SMALLINT,
  created_at DATE NOT NULL,
  interval_days INTEGER,
  next_review_date DATE,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS exam_milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  exam_date DATE NOT NULL,
  subjects TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS simulations (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  summary TEXT,
  applied_at DATE
);

CREATE TABLE IF NOT EXISTS schedule_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at DATE NOT NULL,
  status TEXT NOT NULL,
  original JSONB NOT NULL DEFAULT '[]'::jsonb,
  replacement JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  restored JSONB,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS sessions_user_date_idx ON study_sessions(user_id, study_date);
CREATE INDEX IF NOT EXISTS reviews_user_due_idx ON review_schedules(user_id, due) WHERE status = 'scheduled';
