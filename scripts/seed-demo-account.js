const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { findUserByEmail, createUser } = require('../lib/user-repository');

function relDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const email = 'minhanh@tb.demo';
  if (await findUserByEmail(email)) {
    console.log(`Seed skipped: ${email} already exists.`);
    return;
  }
  const user = await createUser({
    id: 'demo-minh-anh', email, passwordHash: await bcrypt.hash('demo123', 12), onboarded: true,
    profile: { name: 'Minh Anh', grade: 'Lớp 12A1', goal: 'Tăng sự tự tin trước kỳ thi cuối kỳ', timezone: 'Asia/Ho_Chi_Minh' },
    availability: { start: '15:00', end: '21:30', days: [1, 2, 3, 4, 5, 6, 0] },
    settings: { reminders: true, coach: true },
    subjects: [
      { id: 'math', name: 'Toán', target: 'Đạt 8.5 trong kỳ thi tới', color: 'math', icon: '∫', topics: [
        { id: 'functions', name: 'Hàm số', mastery: 85, quiz: { before: 7, after: 8, retention: 8 } },
        { id: 'derivatives', name: 'Đạo hàm', mastery: 55, quiz: { before: 5, after: 6, retention: 5 } },
        { id: 'integral', name: 'Tích phân', mastery: 70, quiz: { before: 5, after: 8, retention: 7 } },
      ] },
      { id: 'informatics', name: 'Tin học', target: 'Củng cố thuật toán HSG', color: 'info', icon: '&lt;/&gt;', topics: [
        { id: 'dp', name: 'Dynamic Programming', mastery: 42, quiz: { before: 4, after: 5, retention: 4 } },
        { id: 'graphs', name: 'Đồ thị', mastery: 58, quiz: { before: 5, after: 6, retention: 5 } },
      ] },
    ],
    tasks: [
      { id: 'task-integral', subjectId: 'math', topicId: 'integral', title: 'Làm 20 bài vận dụng Tích phân', deadline: relDate(0), minutes: 45, priority: 5, status: 'open', createdAt: relDate(-3) },
      { id: 'task-dp', subjectId: 'informatics', topicId: 'dp', title: 'Hoàn thiện bài Dynamic Programming', deadline: relDate(1), minutes: 60, priority: 4, status: 'open', createdAt: relDate(-2) },
    ],
    fixedSchedules: [{ id: 'fixed-school', title: 'Học trên trường', day: 4, start: '07:00', end: '11:30', type: 'school' }],
    sessions: [{ id: 'session-1', topicId: 'integral', minutes: 45, understanding: 4, status: 'complete', date: relDate(-1) }],
    reviewSchedules: [{ id: 'review-integral', topicId: 'integral', due: relDate(0), interval: 7, status: 'scheduled' }],
    studyNotes: [],
    examMilestones: [{ id: 'm-midterm1', title: 'Thi Giữa Học Kỳ I', date: relDate(35), subjects: 'Toán, Vật lí, Hóa học' }],
    lastSimulation: null, scheduleChanges: [],
  });
  console.log(`Seeded ${user.email} with id ${user.id}.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
