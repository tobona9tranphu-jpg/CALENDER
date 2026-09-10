const { query, withTransaction } = require('./db');

function safeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

async function findUserByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] ? loadUser(result.rows[0].id) : null;
}

async function loadUser(userId) {
  const result = await query(`
    SELECT
      u.id, u.email, u.password_hash AS "passwordHash", u.onboarded,
      u.profile_name, u.profile_grade, u.profile_goal, u.timezone,
      to_char(u.availability_start, 'HH24:MI') AS availability_start,
      to_char(u.availability_end, 'HH24:MI') AS availability_end,
      COALESCE(us.reminders, TRUE) AS reminders, COALESCE(us.coach, TRUE) AS coach,
      COALESCE((SELECT json_agg(ad.weekday ORDER BY ad.weekday) FROM availability_days ad WHERE ad.user_id = u.id), '[]') AS availability_days,
      COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'target', s.target, 'color', s.color, 'icon', s.icon,
        'topics', COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'mastery', t.mastery,
          'quiz', json_build_object('before', t.quiz_before, 'after', t.quiz_after, 'retention', t.quiz_retention)) ORDER BY t.name) FROM topics t WHERE t.subject_id = s.id), '[]')) ORDER BY s.name) FROM subjects s WHERE s.user_id = u.id), '[]') AS subjects,
      COALESCE((SELECT json_agg(json_build_object('id', t.id, 'subjectId', t.subject_id, 'topicId', t.topic_id, 'title', t.title, 'deadline', t.deadline, 'minutes', t.minutes, 'priority', t.priority, 'status', t.status, 'createdAt', t.created_at) ORDER BY t.created_at DESC) FROM tasks t WHERE t.user_id = u.id), '[]') AS tasks,
      COALESCE((SELECT json_agg(json_build_object('id', f.id, 'title', f.title, 'day', f.weekday, 'start', f.starts_at, 'end', f.ends_at, 'type', f.schedule_type, 'flexible', f.flexible, 'replacementChangeId', f.replacement_change_id)) FROM fixed_schedules f WHERE f.user_id = u.id), '[]') AS fixed_schedules,
      COALESCE((SELECT json_agg(json_build_object('id', s.id, 'topicId', s.topic_id, 'taskId', s.task_id, 'minutes', s.minutes, 'understanding', s.understanding, 'status', s.status, 'date', s.study_date) ORDER BY s.study_date DESC) FROM study_sessions s WHERE s.user_id = u.id), '[]') AS sessions,
      COALESCE((SELECT json_agg(json_build_object('id', r.id, 'topicId', r.topic_id, 'due', r.due, 'interval', r.interval_days, 'status', r.status, 'noteId', r.note_id) ORDER BY r.due) FROM review_schedules r WHERE r.user_id = u.id), '[]') AS review_schedules,
      COALESCE((SELECT json_agg(json_build_object('id', n.id, 'subjectId', n.subject_id, 'topicName', n.topic_name, 'noteText', n.note_text, 'photoUrl', n.photo_url, 'understanding', n.understanding, 'createdAt', n.created_at, 'interval', n.interval_days, 'nextReviewDate', n.next_review_date, 'reviewed', n.reviewed) ORDER BY n.created_at DESC) FROM study_notes n WHERE n.user_id = u.id), '[]') AS study_notes,
      COALESCE((SELECT json_agg(json_build_object('id', m.id, 'title', m.title, 'date', m.exam_date, 'subjects', m.subjects) ORDER BY m.exam_date) FROM exam_milestones m WHERE m.user_id = u.id), '[]') AS exam_milestones,
      (SELECT json_build_object('summary', x.summary, 'appliedAt', x.applied_at) FROM simulations x WHERE x.user_id = u.id) AS last_simulation,
      COALESCE((SELECT json_agg(json_build_object('id', c.id, 'createdAt', c.created_at, 'status', c.status, 'original', c.original, 'replacement', c.replacement, 'conflicts', c.conflicts, 'restored', c.restored, 'summary', c.summary) ORDER BY c.created_at DESC) FROM schedule_changes c WHERE c.user_id = u.id), '[]') AS schedule_changes
    FROM users u LEFT JOIN user_settings us ON us.user_id = u.id WHERE u.id = $1
  `, [userId]);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id, email: row.email, passwordHash: row.passwordHash, onboarded: row.onboarded,
    profile: { name: row.profile_name, grade: row.profile_grade, goal: row.profile_goal, timezone: row.timezone },
    availability: { start: row.availability_start, end: row.availability_end, days: row.availability_days },
    settings: { reminders: row.reminders, coach: row.coach }, subjects: row.subjects, tasks: row.tasks,
    fixedSchedules: row.fixed_schedules, sessions: row.sessions, reviewSchedules: row.review_schedules,
    studyNotes: row.study_notes, examMilestones: row.exam_milestones, lastSimulation: row.last_simulation, scheduleChanges: row.schedule_changes,
  };
}

async function createUser(user) {
  await withTransaction(async client => {
    await client.query(`INSERT INTO users (id, email, password_hash, onboarded, profile_name, profile_grade, profile_goal, timezone, availability_start, availability_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [user.id, user.email, user.passwordHash, user.onboarded, user.profile.name, user.profile.grade, user.profile.goal, user.profile.timezone, user.availability.start, user.availability.end]);
    await client.query('INSERT INTO user_settings (user_id, reminders, coach) VALUES ($1,$2,$3)', [user.id, user.settings.reminders, user.settings.coach]);
    for (const day of user.availability.days) await client.query('INSERT INTO availability_days (user_id, weekday) VALUES ($1,$2)', [user.id, day]);
  });
  return loadUser(user.id);
}

async function replaceUser(user) {
  await withTransaction(async client => {
    await client.query('UPDATE users SET onboarded=$2, profile_name=$3, profile_grade=$4, profile_goal=$5, timezone=$6, availability_start=$7, availability_end=$8, updated_at=NOW() WHERE id=$1', [user.id, user.onboarded, user.profile.name, user.profile.grade, user.profile.goal, user.profile.timezone, user.availability.start, user.availability.end]);
    await client.query('INSERT INTO user_settings (user_id, reminders, coach) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET reminders=$2, coach=$3', [user.id, user.settings.reminders, user.settings.coach]);
    const tables = ['availability_days', 'subjects', 'tasks', 'fixed_schedules', 'study_sessions', 'review_schedules', 'study_notes', 'exam_milestones', 'simulations', 'schedule_changes'];
    for (const table of tables) await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [user.id]);
    for (const day of user.availability.days || []) await client.query('INSERT INTO availability_days (user_id, weekday) VALUES ($1,$2)', [user.id, day]);
    for (const subject of user.subjects || []) {
      await client.query('INSERT INTO subjects (id,user_id,name,target,color,icon) VALUES ($1,$2,$3,$4,$5,$6)', [subject.id,user.id,subject.name,subject.target || '',subject.color || 'custom',subject.icon || null]);
      for (const topic of subject.topics || []) await client.query('INSERT INTO topics (id,subject_id,name,mastery,quiz_before,quiz_after,quiz_retention) VALUES ($1,$2,$3,$4,$5,$6,$7)', [topic.id,subject.id,topic.name,topic.mastery || 0,topic.quiz?.before ?? null,topic.quiz?.after ?? null,topic.quiz?.retention ?? null]);
    }
    for (const task of user.tasks || []) await client.query('INSERT INTO tasks (id,user_id,subject_id,topic_id,title,deadline,minutes,priority,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [task.id,user.id,task.subjectId || null,task.topicId || null,task.title,task.deadline,task.minutes,task.priority || 3,task.status,task.createdAt]);
    for (const item of user.fixedSchedules || []) await client.query('INSERT INTO fixed_schedules (id,user_id,title,weekday,starts_at,ends_at,schedule_type,flexible,replacement_change_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [item.id,user.id,item.title,item.day,item.start || null,item.end || null,item.type,item.flexible || false,item.replacementChangeId || null]);
    for (const item of user.sessions || []) await client.query('INSERT INTO study_sessions (id,user_id,topic_id,task_id,minutes,understanding,status,study_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [item.id,user.id,item.topicId || null,item.taskId || null,item.minutes,item.understanding || null,item.status,item.date]);
    for (const item of user.reviewSchedules || []) await client.query('INSERT INTO review_schedules (id,user_id,topic_id,due,interval_days,status,note_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [item.id,user.id,item.topicId,item.due,item.interval,item.status,item.noteId || null]);
    for (const item of user.studyNotes || []) await client.query('INSERT INTO study_notes (id,user_id,subject_id,topic_name,note_text,photo_url,understanding,created_at,interval_days,next_review_date,reviewed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [item.id,user.id,item.subjectId || null,item.topicName,item.noteText || '',item.photoUrl || null,item.understanding || null,item.createdAt,item.interval || null,item.nextReviewDate || null,item.reviewed || false]);
    for (const item of user.examMilestones || []) await client.query('INSERT INTO exam_milestones (id,user_id,title,exam_date,subjects) VALUES ($1,$2,$3,$4,$5)', [item.id,user.id,item.title,item.date,item.subjects || '']);
    if (user.lastSimulation) await client.query('INSERT INTO simulations (user_id,summary,applied_at) VALUES ($1,$2,$3)', [user.id,user.lastSimulation.summary,user.lastSimulation.appliedAt]);
    for (const item of user.scheduleChanges || []) await client.query('INSERT INTO schedule_changes (id,user_id,created_at,status,original,replacement,conflicts,restored,summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [item.id,user.id,item.createdAt,item.status,JSON.stringify(item.original || []),JSON.stringify(item.replacement || []),JSON.stringify(item.conflicts || []),item.restored ? JSON.stringify(item.restored) : null,item.summary || null]);
  });
  return loadUser(user.id);
}

module.exports = { safeUser, findUserByEmail, loadUser, createUser, replaceUser };
