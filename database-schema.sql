-- PostgreSQL-ready data model for the Luma backend.
-- UUID generation and timestamps may be supplied by the hosting platform.

CREATE TABLE users (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  study_window_start TIME,
  study_window_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subjects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_score NUMERIC(5,2),
  color_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE topics (
  id UUID PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mastery_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  mastery_status TEXT NOT NULL DEFAULT 'weak' CHECK (mastery_status IN ('weak', 'improving', 'good', 'mastered')),
  last_reviewed_at TIMESTAMPTZ
);

CREATE TABLE fixed_schedules (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  weekday SMALLINT CHECK (weekday BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('school', 'tutoring', 'personal'))
);

CREATE TABLE deadlines (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5)
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  deadline_id UUID REFERENCES deadlines(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'scheduled', 'complete', 'skipped')),
  completed_at TIMESTAMPTZ
);

CREATE TABLE study_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  planned_minutes INTEGER NOT NULL,
  completed_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('planned', 'complete', 'missed', 'cancelled')),
  understanding_rating SMALLINT CHECK (understanding_rating BETWEEN 1 AND 5)
);

CREATE TABLE quiz_results (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  session_id UUID REFERENCES study_sessions(id) ON DELETE SET NULL,
  score NUMERIC(5,2) NOT NULL,
  score_max NUMERIC(5,2) NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE progress (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  score_before NUMERIC(5,2),
  score_after NUMERIC(5,2),
  retention_score NUMERIC(5,2),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_schedules (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  interval_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'missed'))
);

CREATE INDEX study_sessions_user_start_idx ON study_sessions(user_id, starts_at);
CREATE INDEX tasks_user_status_idx ON tasks(user_id, status);
CREATE INDEX review_schedules_due_idx ON review_schedules(user_id, due_at) WHERE status = 'scheduled';
