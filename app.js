const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const API = '/api';
// NOTE: TB-auth-token is an HttpOnly cookie managed by the server.
// Client-side JS must NEVER read, write, or store the auth token.
const STORAGE_LOCAL_ACCOUNTS = 'TB-demo-accounts-v2';
const STORAGE_LOCAL_CURRENT  = 'TB-demo-current-user-v2';
// Offline/demo mode marker — stores only the local- session ID, never a real JWT.
const STORAGE_OFFLINE_SESSION = 'TB-offline-session-v1';

/** Returns the offline local session ID (e.g. "local-user-xxx"), or null. */
function getOfflineSession() { return localStorage.getItem(STORAGE_OFFLINE_SESSION); }
/** Persists the offline session ID. Pass null to clear. */
function setOfflineSession(id) {
  if (id) localStorage.setItem(STORAGE_OFFLINE_SESSION, id);
  else localStorage.removeItem(STORAGE_OFFLINE_SESSION);
}
/** True when running in offline/demo mode (not authenticated against the server). */
function isOfflineMode() { const s = getOfflineSession(); return !!s && s.startsWith('local-'); }

const DateUtil = (typeof AppDate !== 'undefined')
  ? AppDate
  : (typeof require === 'function' ? (function() { try { return require('./src/utils/date'); } catch { return null; } })() : null);

const RecurrenceEngineUtil = (typeof RecurrenceEngine !== 'undefined')
  ? RecurrenceEngine
  : (typeof require === 'function' ? (function() { try { return require('./src/recurrence/recurrence-engine'); } catch { return null; } })() : null);

const DataIntegrityUtil = (typeof DataIntegrity !== 'undefined')
  ? DataIntegrity
  : (typeof require === 'function' ? (function() { try { return require('./src/recurrence/data-integrity'); } catch { return null; } })() : null);

const TodayEngineUtil = (typeof TodayEngine !== 'undefined')
  ? TodayEngine
  : (typeof require === 'function' ? (function() { try { return require('./src/today/today-engine'); } catch { return null; } })() : null);

const QuickCaptureUtil = (typeof QuickCapture !== 'undefined')
  ? QuickCapture
  : (typeof require === 'function' ? (function() { try { return require('./src/today/quick-capture'); } catch { return null; } })() : null);

const InboxServiceUtil = (typeof InboxService !== 'undefined')
  ? InboxService
  : (typeof require === 'function' ? (function() { try { return require('./src/today/inbox-service'); } catch { return null; } })() : null);

const AIFoundationUtil = (typeof AIFoundation !== 'undefined')
  ? AIFoundation
  : (typeof require === 'function' ? (function() { try { return require('./src/ai'); } catch { return null; } })() : null);

const ClientAIAdapterUtil = (typeof AIProvider !== 'undefined' && AIProvider.ClientAIAdapter)
  ? AIProvider.ClientAIAdapter
  : (AIFoundationUtil && AIFoundationUtil.ClientAIAdapter ? AIFoundationUtil.ClientAIAdapter : null);

function getLocalAccounts() {
  try {
    let list = null;
    if (DataIntegrityUtil && DataIntegrityUtil.safeLoadStorage) {
      list = DataIntegrityUtil.safeLoadStorage(STORAGE_LOCAL_ACCOUNTS, localStorage, null);
    } else {
      list = JSON.parse(localStorage.getItem(STORAGE_LOCAL_ACCOUNTS) || '[]');
    }
    if (!list || !Array.isArray(list) || !list.length) {
      const seed = seedAccount();
      localStorage.setItem(STORAGE_LOCAL_ACCOUNTS, JSON.stringify([seed]));
      return [seed];
    }
    if (DataIntegrityUtil && DataIntegrityUtil.processUserDataPipeline) {
      list = list.map(acc => {
        const res = DataIntegrityUtil.processUserDataPipeline(acc);
        return res ? res.data : acc;
      });
    }
    return list;
  } catch {
    return [seedAccount()];
  }
}

function setLocalAccounts(accounts) {
  localStorage.setItem(STORAGE_LOCAL_ACCOUNTS, JSON.stringify(accounts));
}

function saveLocalUser(user) {
  if (!user || !user.id) return;
  if (DataIntegrityUtil && DataIntegrityUtil.processUserDataPipeline) {
    const res = DataIntegrityUtil.processUserDataPipeline(user);
    if (res && res.data) user = res.data;
  }
  const list = getLocalAccounts();
  const idx = list.findIndex(a => a.id === user.id);
  if (idx >= 0) list[idx] = clone(user);
  else list.push(clone(user));
  setLocalAccounts(list);
}

async function api(method, path, body = null) {
  if (window.location.protocol === 'file:') {
    throw new Error('OFFLINE_MODE');
  }
  // Auth is provided automatically via the HttpOnly TB-auth-token cookie.
  // Never read, construct, or attach the token manually.
  const opts = {
    method,
    credentials: 'include',            // send the HttpOnly cookie on every request
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(API + path, opts);
  } catch {
    throw new Error('OFFLINE_MODE');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('OFFLINE_MODE');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('OFFLINE_MODE');
  }

  if (res.status === 401) throw new Error('SESSION_EXPIRED');
  if (res.status === 403) throw new Error('FORBIDDEN');
  if (!res.ok) throw new Error(data.error || 'Lỗi server');
  return data;
}

// ── Notification Engine Foundation (P0.4) ──────────────────────────────────
let notificationService = null;
let notificationStore = null;
let notificationScheduler = null;

try {
  const NotifServiceClass = (typeof NotificationService !== 'undefined' && NotificationService.NotificationService)
    ? NotificationService.NotificationService
    : (typeof AppNotification !== 'undefined' ? AppNotification.NotificationService : null);

  const NotifStoreClass = (typeof NotificationStore !== 'undefined' && NotificationStore.NotificationStore)
    ? NotificationStore.NotificationStore
    : (typeof AppNotification !== 'undefined' ? AppNotification.NotificationStore : null);

  const ToastUIClass = (typeof ToastUI !== 'undefined' && ToastUI.ToastUI)
    ? ToastUI.ToastUI
    : (typeof AppNotification !== 'undefined' ? AppNotification.ToastUI : null);

  const NotifSchedulerClass = (typeof NotificationScheduler !== 'undefined' && NotificationScheduler.NotificationScheduler)
    ? NotificationScheduler.NotificationScheduler
    : (typeof AppNotification !== 'undefined' ? AppNotification.NotificationScheduler : null);

  if (NotifStoreClass) {
    notificationStore = new NotifStoreClass();
  }
  const toastUIInstance = ToastUIClass ? new ToastUIClass({ container: '#toastContainer' }) : null;

  if (NotifServiceClass) {
    notificationService = new NotifServiceClass({
      store: notificationStore,
      toast: toastUIInstance
    });
    notificationScheduler = notificationService.scheduler;
  }
} catch (err) {
  console.warn('Notification service initialization fallback:', err);
}

function getToday() {
  return DateUtil ? DateUtil.getTodayAppDate() : (new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
}
let TODAY = getToday();
let scheduleViewDate = TODAY;
let calendarMonth = Number(TODAY.split('-')[1]) - 1;
let calendarYear = Number(TODAY.split('-')[0]);
const DEMO_EMAIL = 'minhanh@tb.demo';
const DEMO_PASSWORD = 'demo123';
const dayNames = (DateUtil && DateUtil.DAY_NAMES_VI) || ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

const EXAM_COMBINATIONS = {
  'A00': ['Toán', 'Vật lí', 'Hóa học'],
  'A01': ['Toán', 'Vật lí', 'Tiếng Anh'],
  'B00': ['Toán', 'Hóa học', 'Sinh học'],
  'C00': ['Ngữ văn', 'Lịch sử', 'Địa lí'],
  'D01': ['Toán', 'Ngữ văn', 'Tiếng Anh'],
  'D07': ['Toán', 'Hóa học', 'Tiếng Anh'],
};

const SUBJECT_METADATA = {
  'Toán': { color: 'math', icon: '∫', defaultTopic: 'Hàm số & Đạo hàm' },
  'Ngữ văn': { color: 'literature', icon: '✎', defaultTopic: 'Nghị luận văn học' },
  'Tiếng Anh': { color: 'english', icon: 'A', defaultTopic: 'Ngữ pháp & Từ vựng' },
  'Vật lí': { color: 'physics', icon: '⚡', defaultTopic: 'Dao động cơ' },
  'Hóa học': { color: 'chemistry', icon: '🧪', defaultTopic: 'Este & Lipit' },
  'Sinh học': { color: 'biology', icon: '🧬', defaultTopic: 'Cơ chế di truyền' },
  'Lịch sử': { color: 'history', icon: '🏛', defaultTopic: 'Lịch sử Việt Nam (1919 - 1975)' },
  'Địa lí': { color: 'geography', icon: '🌍', defaultTopic: 'Địa lí tự nhiên & dân cư' },
  'Tin học': { color: 'info', icon: '</>', defaultTopic: 'Thuật toán cơ bản' },
  'GDCD': { color: 'civics', icon: '⚖', defaultTopic: 'Công dân với Pháp luật' },
  'IELTS': { color: 'ielts', icon: '★', defaultTopic: 'Reading & Writing' },
};

let currentUser = null;
let activePage = 'home';
let taskFilter = 'open';
let onboardingStep = 1;
let onboardingChosenSubjects = new Set(EXAM_COMBINATIONS['A00']);
let onboardingChosenDays = new Set([1, 2, 3, 4, 5]);
let selectedTimerTask = null;
let timerSeconds = 0;
let timerTotal = 0;
let timerRunning = false;
let timerInterval = null;
let pendingScheduleConflict = null;
let pendingTimerCompletion = null;

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const isSafeImageUrl = (url = '') => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (e) {
    return false;
  }
};
const dateFrom = (value) => {
  if (DateUtil) {
    const parsed = DateUtil.parseAppDate(value);
    return parsed ? DateUtil.startOfAppDay(parsed) : new Date(NaN);
  }
  return new Date(value);
};
const minFromTime = (value) => DateUtil ? DateUtil.minFromTime(value) : (() => { const [h, m] = (value || '0:0').split(':').map(Number); return (h||0) * 60 + (m||0); })();
const timeFromMin = (value) => DateUtil ? DateUtil.timeFromMin(value) : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const formatMinutes = (value) => DateUtil ? DateUtil.formatMinutes(value) : `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`;
const formatVietnameseDate = (d) => DateUtil ? DateUtil.formatVietnameseDate(d) : String(d);
const formatShortDate = (value) => DateUtil ? DateUtil.formatShortDate(value) : String(value);

function normalizeDateInput(value) {
  if (!value) return null;
  return DateUtil ? DateUtil.parseAppDate(value) : value;
}
function calculateDaysUntil(dateValue) {
  if (!DateUtil) return null;
  const parsed = DateUtil.parseAppDate(dateValue);
  if (!parsed) return null;
  return DateUtil.diffAppCalendarDays(parsed, TODAY);
}
function getReviewIntervalByUnderstanding(understanding) {
  const mapping = { 1: 1, 2: 2, 3: 3, 4: 7, 5: 14 };
  return mapping[Number(understanding)] || 3;
}
function scheduleReviewForTopic(topicId, understanding, options = {}) {
  const topic = getTopic(topicId);
  if (!topic) return null;
  const interval = getReviewIntervalByUnderstanding(understanding);
  const days = Number(options.days ?? interval);
  const due = DateUtil ? DateUtil.addAppDays(TODAY, days) : TODAY;
  currentUser.reviewSchedules = (currentUser.reviewSchedules || []).filter(review => review.topicId !== topicId || review.status !== 'scheduled');
  currentUser.reviewSchedules.push({
    id: uid('review'),
    topicId,
    due,
    interval: days,
    status: 'scheduled',
    ...options.extra
  });
  return { topic, due, interval: days };
}

function relDate(offset) {
  return DateUtil ? DateUtil.addAppDays(TODAY, offset) : TODAY;
}

function seedAccount() {
  return {
    id: 'demo-minh-anh',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    onboarded: true,
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
      { id: 'ielts', name: 'IELTS', target: 'Mục tiêu overall 7.0', color: 'ielts', icon: 'A', topics: [
        { id: 'reading', name: 'Reading', mastery: 82, quiz: { before: 7, after: 8, retention: 8 } },
        { id: 'listening', name: 'Listening', mastery: 79, quiz: { before: 7, after: 8, retention: 7 } },
        { id: 'writing', name: 'Writing Task 2', mastery: 65, quiz: { before: 6, after: 7, retention: 6 } },
      ] },
    ],
    tasks: [
      { id: 'task-integral', subjectId: 'math', topicId: 'integral', title: 'Làm 20 bài vận dụng Tích phân', deadline: relDate(0), scheduledDate: relDate(0), minutes: 45, priority: 5, status: 'open', isInbox: false, createdAt: relDate(-3) },
      { id: 'task-dp', subjectId: 'informatics', topicId: 'dp', title: 'Hoàn thiện bài Dynamic Programming', deadline: relDate(1), scheduledDate: relDate(1), minutes: 60, priority: 4, status: 'open', isInbox: false, createdAt: relDate(-2) },
      { id: 'task-listening', subjectId: 'ielts', topicId: 'listening', title: 'IELTS Listening · Test 3', deadline: relDate(2), scheduledDate: relDate(2), minutes: 40, priority: 3, status: 'open', isInbox: false, createdAt: relDate(-1) },
      { id: 'task-functions', subjectId: 'math', topicId: 'functions', title: 'Tóm tắt công thức hàm số', deadline: relDate(-1), scheduledDate: relDate(-1), minutes: 25, priority: 2, status: 'done', isInbox: false, createdAt: relDate(-4) },
      { id: 'task-inbox-1', subjectId: 'math', topicId: 'integral', title: 'Luyện 10 câu trắc nghiệm Tích phân vận dụng cao', deadline: null, scheduledDate: null, minutes: 30, priority: 4, status: 'open', isInbox: true, createdAt: relDate(-1) },
      { id: 'task-inbox-2', subjectId: 'ielts', topicId: 'writing', title: 'Đọc bài mẫu Writing Task 2 band 8.0', deadline: null, scheduledDate: null, minutes: 45, priority: 3, status: 'open', isInbox: true, createdAt: relDate(-2) },
    ],
    fixedSchedules: [
      { id: 'fixed-school', title: 'Học trên trường', day: 4, start: '07:00', end: '11:30', type: 'school' },
      { id: 'fixed-tutoring', title: 'Học thêm Toán', day: 4, start: '17:30', end: '19:00', type: 'tutoring' },
      { id: 'fixed-club', title: 'CLB Tin học', day: 2, start: '17:00', end: '18:30', type: 'personal' },
    ],
    sessions: [
      { id: 'session-1', topicId: 'reading', minutes: 40, understanding: 4, status: 'complete', date: relDate(0) },
      { id: 'session-2', topicId: 'integral', minutes: 45, understanding: 4, status: 'complete', date: relDate(-1) },
      { id: 'session-3', topicId: 'writing', minutes: 45, understanding: 4, status: 'complete', date: relDate(-2) },
      { id: 'session-4', topicId: 'dp', minutes: 45, understanding: 2, status: 'missed', date: relDate(-2) },
      { id: 'session-5', topicId: 'dp', minutes: 60, understanding: 0, status: 'missed', date: relDate(-3) },
      { id: 'session-6', topicId: 'functions', minutes: 25, understanding: 5, status: 'complete', date: relDate(-4) },
      { id: 'session-7', topicId: 'listening', minutes: 45, understanding: 4, status: 'complete', date: relDate(-5) },
    ],
    reviewSchedules: [
      { id: 'review-integral', topicId: 'integral', due: relDate(0), interval: 7, status: 'scheduled' },
      { id: 'review-derivatives', topicId: 'derivatives', due: relDate(3), interval: 3, status: 'scheduled' },
    ],
    studyNotes: [
      {
        id: 'note-sample-1',
        subjectId: 'math',
        topicName: 'Đạo hàm hàm hợp & Quy tắc chuỗi',
        noteText: 'Đã nắm công thức u^n, sin(u), cos(u). Cần làm thêm bài tập nâng cao phân thức bậc 2.',
        photoUrl: null,
        understanding: 4,
        createdAt: relDate(-1),
        interval: 3,
        nextReviewDate: relDate(2),
        reviewed: false
      },
      {
        id: 'note-sample-2',
        subjectId: 'informatics',
        topicName: 'Quy hoạch động trên mảng 2 chiều',
        noteText: 'Xong bài toán Tìm đường đi có tổng lớn nhất. Cần ôn lại cách truy vết kết quả.',
        photoUrl: null,
        understanding: 3,
        createdAt: relDate(-2),
        interval: 1,
        nextReviewDate: relDate(0),
        reviewed: false
      }
    ],
    examMilestones: [
      { id: 'm-midterm1', title: 'Thi Giữa Học Kỳ I', date: relDate(35), subjects: 'Toán, Vật lí, Hóa học, Ngữ văn, Tiếng Anh' },
      { id: 'm-final1', title: 'Thi Cuối Học Kỳ I', date: relDate(95), subjects: 'Toán, Vật lí, Hóa học, Tiếng Anh, Sinh học' },
      { id: 'm-thpt', title: 'Kỳ thi Tốt nghiệp THPT 2026', date: '2026-06-26', subjects: 'Toán, Ngữ văn, Tiếng Anh, Vật lí' },
    ],
    lastSimulation: null,
    scheduleChanges: [],
  };
}

function blankAccount({ id, email, name }) {
  return {
    id, email, onboarded: false,
    profile: { name, grade: '', goal: '', timezone: 'Asia/Ho_Chi_Minh' },
    availability: { start: '15:00', end: '21:00', days: [1, 2, 3, 4, 5] },
    settings: { reminders: true, coach: true },
    subjects: [], tasks: [], fixedSchedules: [], sessions: [], reviewSchedules: [],
    studyNotes: [],
    examMilestones: [
      { id: 'm-midterm1', title: 'Thi Giữa Học Kỳ I', date: relDate(45), subjects: 'Các môn chính' },
      { id: 'm-final1', title: 'Thi Cuối Học Kỳ I', date: relDate(100), subjects: 'Tất cả các môn' },
      { id: 'm-thpt', title: 'Kỳ thi Tốt nghiệp THPT 2026', date: '2026-06-26', subjects: 'Tổ hợp thi' }
    ],
    lastSimulation: null, scheduleChanges: []
  };
}

let persistTimer = null;
function persist() {
  if (!currentUser) return;
  // Always persist locally as primary/backup storage
  saveLocalUser(currentUser);

  // Sync to server when in server mode (cookie auth, not offline/demo mode).
  // credentials:'include' in api() ensures the HttpOnly cookie is sent automatically.
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (isOfflineMode()) return; // skip server sync in demo/offline mode
    api('PUT', '/user', currentUser).catch(() => {
      // Ignored: local copy is already saved
    });
  }, 500);
}
function getSubject(id) { return currentUser.subjects.find(subject => subject.id === id); }
function getTopic(id) { for (const subject of currentUser.subjects) { const topic = subject.topics.find(item => item.id === id); if (topic) return { ...topic, subject }; } return null; }
function getTask(id) { return currentUser.tasks.find(task => task.id === id); }

function appearance(subject) {
  const palette = {
    math: ['math', 'math-color', 'math-card'],
    literature: ['literature', 'literature-color', 'literature-card'],
    english: ['english', 'english-color', 'english-card'],
    physics: ['physics', 'physics-color', 'physics-card'],
    chemistry: ['chemistry', 'chemistry-color', 'chemistry-card'],
    biology: ['biology', 'biology-color', 'biology-card'],
    history: ['history', 'history-color', 'history-card'],
    geography: ['geography', 'geography-color', 'geography-card'],
    info: ['info', 'info-color', 'info-card'],
    civics: ['civics', 'civics-color', 'civics-card'],
    ielts: ['ielts', 'ielts-color', 'ielts-card'],
  };
  const [orb, category, card] = palette[subject.color] || ['custom', 'math-color', 'math-card'];
  return { orb, category, card, icon: subject.icon || subject.name.slice(0, 1).toUpperCase(), badge: subject.name.length > 5 ? subject.name.slice(0, 3).toUpperCase() : subject.name.toUpperCase() };
}
function subjectAverage(subject) { return subject.topics.length ? Math.round(subject.topics.reduce((sum, topic) => sum + Number(topic.mastery || 0), 0) / subject.topics.length) : 0; }
function getSubjectProgressCards(limit = 3) {
  if (!currentUser?.subjects?.length) return [];
  return [...currentUser.subjects]
    .map(subject => ({
      ...subject,
      average: subjectAverage(subject),
      topicsCount: subject.topics?.length || 0,
    }))
    .sort((a, b) => b.average - a.average)
    .slice(0, limit);
}
function masteryStatus(mastery) { if (mastery >= 85) return ['Mastered', 'status-mastered']; if (mastery >= 70) return ['Good', 'status-good']; if (mastery >= 45) return ['Improving', 'status-improving']; return ['Weak', 'status-weak']; }
function priorityLabel(score) {
  if (score >= 80) return ['Khẩn cấp', 'critical'];
  if (score >= 60) return ['Quan trọng', 'high'];
  if (score >= 40) return ['Nên làm', 'medium'];
  return ['Bình thường', 'regular'];
}
function deadlineText(value) {
  if (DateUtil) return DateUtil.formatDeadlineText(value, TODAY);
  const difference = Math.round((dateFrom(value) - dateFrom(TODAY)) / 86400000);
  if (difference < 0) return `Quá hạn ${Math.abs(difference)} ngày`;
  if (difference === 0) return 'Hạn chót hôm nay';
  if (difference === 1) return 'Hạn chót ngày mai';
  return `Hạn chót ${formatShortDate(value)}`;
}
function getPriorityScoreBreakdown(task) {
  const topic = getTopic(task.topicId);
  const mastery = Number(topic?.mastery ?? 50);
  const dateValue = task.deadline || TODAY;
  const days = DateUtil ? DateUtil.diffAppCalendarDays(dateValue, TODAY) : Math.round((dateFrom(dateValue) - dateFrom(TODAY)) / 86400000);
  const closestExam = (currentUser.examMilestones || [])
    .filter(item => (DateUtil ? DateUtil.diffAppCalendarDays(item.date, TODAY) >= 0 : dateFrom(item.date) >= dateFrom(TODAY)))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const examDays = closestExam ? (DateUtil ? DateUtil.diffAppCalendarDays(closestExam.date, TODAY) : Math.round((dateFrom(closestExam.date) - dateFrom(TODAY)) / 86400000)) : 999;
  const reviewDue = (currentUser.reviewSchedules || []).some(item => item.topicId === task.topicId && item.status === 'scheduled' && (DateUtil ? DateUtil.diffAppCalendarDays(item.due, TODAY) <= 0 : dateFrom(item.due) <= dateFrom(TODAY)));
  const missedSessions = (currentUser.sessions || []).filter(session => session.topicId === task.topicId && session.status === 'missed').length;

  const deadlineUrgency = Math.max(0, 30 - Math.max(days, 0) * 6) + (days <= 0 ? 20 : 0);
  const examProximity = examDays <= 7 ? Math.max(0, 40 - examDays * 5) : 0;
  const knowledgeWeakness = Math.max(0, (100 - mastery) * 0.35);
  const reviewScore = reviewDue ? 20 : 0;
  const missedScore = Math.min(20, missedSessions * 10);
  const taskPriority = Number(task.priority || 3) * 7;
  const importanceBoost = Number(task.minutes || 45) >= 60 ? 8 : 4;

  return {
    deadlineUrgency,
    examProximity,
    knowledgeWeakness,
    reviewScore,
    missedScore,
    taskPriority,
    importanceBoost,
    days,
    examDays,
    mastery,
    reviewDue,
    missedSessions,
  };
}
function calculatePriorityScore(task) {
  const breakdown = getPriorityScoreBreakdown(task);
  const total = breakdown.deadlineUrgency
    + breakdown.examProximity
    + breakdown.knowledgeWeakness
    + breakdown.reviewScore
    + breakdown.missedScore
    + breakdown.taskPriority
    + breakdown.importanceBoost;
  return Math.min(100, Math.round(total));
}
function describePriorityReason(task) {
  const breakdown = getPriorityScoreBreakdown(task);
  const reasons = [];
  if (breakdown.days <= 2) reasons.push(`deadline còn ${Math.max(0, breakdown.days)} ngày`);
  if (breakdown.examDays <= 7) reasons.push(`thi sắp tới (${breakdown.examDays} ngày)`);
  if (breakdown.mastery < 60) reasons.push(`mức nắm vững ${breakdown.mastery}%`);
  if (breakdown.reviewDue) reasons.push('review đến hạn');
  if (breakdown.missedSessions) reasons.push(`${breakdown.missedSessions} phiên bỏ lỡ`);
  return reasons.slice(0, 3).join(' • ') || 'Dựa trên dữ liệu học tập hiện có';
}
function taskPriorityMeta(task) {
  const score = calculatePriorityScore(task);
  const [label, cssClass] = priorityLabel(score);
  let level = 'NORMAL';
  if (score >= 80) level = 'CRITICAL';
  else if (score >= 60) level = 'IMPORTANT';
  else if (score >= 40) level = 'SHOULD DO';
  return { score, label, cssClass, level };
}
function taskScore(task) { return calculatePriorityScore(task); }
function openTasks() { return currentUser.tasks.filter(task => task.status !== 'done').sort((a, b) => taskScore(b) - taskScore(a)); }
function initials() { return currentUser.profile.name.trim().slice(0, 1).toUpperCase() || 'L'; }

function createPlan(forDate = null) {
  const availability = currentUser.availability;
  const viewDate = forDate || TODAY;
  const todayDay = DateUtil ? DateUtil.getAppDayOfWeek(viewDate) : 0;
  const isAvailableDay = availability.days.includes(todayDay);

  let fixed = [];
  if (RecurrenceEngineUtil && RecurrenceEngineUtil.expandOccurrences) {
    for (const event of (currentUser.fixedSchedules || [])) {
      const occs = RecurrenceEngineUtil.expandOccurrences(event, viewDate, viewDate);
      fixed.push(...occs);
    }
  } else {
    fixed = (currentUser.fixedSchedules || []).filter(event => Number(event.day) === todayDay);
  }
  fixed.sort((a, b) => minFromTime(a.start) - minFromTime(b.start));

  const candidateTasks = openTasks().filter(t => !InboxServiceUtil || !InboxServiceUtil.isInboxItem(t));
  const selected = isAvailableDay ? candidateTasks.slice(0, 3) : [];
  let cursor = minFromTime(availability.start);
  const end = minFromTime(availability.end);
  const plan = [];
  for (const task of selected) {
    const duration = Number(task.minutes);
    for (const event of fixed) {
      const fixedStart = minFromTime(event.start); const fixedEnd = minFromTime(event.end);
      if (cursor < fixedEnd && cursor + duration > fixedStart) cursor = fixedEnd + 10;
    }
    if (cursor + duration <= end) { plan.push({ ...task, start: timeFromMin(cursor), end: timeFromMin(cursor + duration) }); cursor += duration + 10; }
  }
  return { fixed, plan, capacity: Math.max(0, end - minFromTime(availability.start) - fixed.reduce((sum, event) => sum + (minFromTime(event.end) - minFromTime(event.start)), 0)) };
}

function derivedInsights() {
  const insights = [];
  const allTopics = currentUser.subjects.flatMap(subject => subject.topics.map(topic => ({ ...topic, subject })));
  const weakest = allTopics.sort((a, b) => a.mastery - b.mastery)[0];
  if (weakest && weakest.mastery < 70) insights.push({ title: `Bạn đang cần thêm thời gian cho ${weakest.name}.`, body: `Mức nắm vững hiện tại là ${weakest.mastery}%, thấp nhất trong các chủ đề bạn đang theo dõi.`, source: `Dựa trên Knowledge Map · ${weakest.subject.name}`, action: 'Xem chủ đề', page: 'subjects' });
  const fortyFive = currentUser.sessions.filter(session => session.minutes === 45);
  const fortyFiveComplete = fortyFive.filter(session => session.status === 'complete').length;
  if (fortyFive.length >= 3) insights.push({ title: `Bạn hoàn thành tốt các phiên 45 phút.`, body: `${Math.round((fortyFiveComplete / fortyFive.length) * 100)}% trong ${fortyFive.length} phiên 45 phút đã được hoàn thành.`, source: `Dựa trên ${fortyFive.length} phiên học đã ghi nhận`, action: 'Ghi phiên 45p', page: 'progress' });
  const missed = currentUser.sessions.filter(session => session.status === 'missed').length;
  if (missed) insights.push({ title: `Bạn đã bỏ lỡ ${missed} phiên học.`, body: `TB đang ưu tiên lại các nhiệm vụ mở trong khung giờ rảnh tiếp theo của bạn.`, source: `Dựa trên lịch sử Study Sessions`, action: 'Xem lịch', page: 'schedule' });
  const review = currentUser.reviewSchedules.filter(item => item.status === 'scheduled').sort((a, b) => a.due.localeCompare(b.due))[0];
  if (review) { const topic = getTopic(review.topicId); if (topic) insights.push({ title: dateFrom(review.due) <= dateFrom(TODAY) ? `Nên ôn lại ${topic.name} hôm nay.` : `${topic.name} cần được ôn vào ${formatShortDate(review.due)}.`, body: `Lần ôn này được tạo theo khoảng cách ${review.interval} ngày từ phiên học trước.`, source: `Dựa trên Review Schedule · ${topic.subject.name}`, action: 'Bắt đầu ôn', page: 'home', review }); }
  if (!insights.length) insights.push({ title: 'Hãy ghi phiên học đầu tiên.', body: 'Khi có dữ liệu về thời lượng, mức độ hiểu hoặc quiz, TB sẽ chỉ hiển thị insight có căn cứ.', source: 'Chưa đủ dữ liệu để suy luận', action: 'Ghi nhanh', page: 'progress' });
  return insights.slice(0, 4);
}

function renderCalendar() {
  const year = calendarYear; const month = calendarMonth;
  const cells = DateUtil ? DateUtil.generateCalendarGrid(year, month, TODAY) : [];
  const monthNames = (DateUtil && DateUtil.MONTH_NAMES_VI) || ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  const calTitle = $('.mini-calendar-head h2');
  if (calTitle) calTitle.textContent = monthNames[month] + ', ' + year;
  $('#calendarDates').innerHTML = cells.map(c => `<span class="${c.muted ? 'muted' : ''} ${c.isToday ? 'today-date' : ''}">${c.day}</span>`).join('');
}
function renderHeader() {
  const name = escapeHTML(currentUser.profile.name);
  $('#headerDate').textContent = activePage === 'home' ? (DateUtil ? DateUtil.formatVietnameseDate(TODAY) : formatVietnameseDate(new Date())) : ({ inbox: 'UNSCHEDULED INBOX', schedule: 'SMART SCHEDULE', subjects: 'SUBJECTS & TOPICS', progress: 'LEARNING PROGRESS', tasks: 'LEARNING TASKS', insights: 'STUDY INSIGHTS', settings: 'YOUR SPACE' }[activePage] || 'TB');
  const titles = { home: `Chào ${name} <span>✦</span>`, inbox: 'Hộp thư việc cần làm', schedule: 'Kế hoạch học', subjects: 'Các môn học', progress: 'Tiến độ học', tasks: 'Nhiệm vụ', insights: 'Góc nhìn học tập', settings: 'Cài đặt' };
  $('#pageTitle').innerHTML = titles[activePage] || 'Tổng quan';
  $('#sidebarName').textContent = currentUser.profile.name;
  $('#sidebarGrade').textContent = currentUser.profile.grade || 'Hồ sơ học mới';
  ['#avatarInitial', '#headerInitial', '#accountModalInitial'].forEach(selector => { const el = $(selector); if (el) el.textContent = initials(); });
  $('#accountModalName').textContent = currentUser.profile.name;
  $('#accountModalEmail').textContent = currentUser.email;
}
function renderToday() {
  if (!currentUser) return;
  const now = DateUtil ? DateUtil.getNowVietnam() : new Date();
  const userName = (currentUser.profile && currentUser.profile.name) ? currentUser.profile.name : 'bạn';

  // 1. Header Greeting & Date
  const greeting = TodayEngineUtil ? TodayEngineUtil.getTimeGreeting(now, userName) : `Chào ${escapeHTML(userName)} ✦`;
  const greetingEl = $('#todayGreeting');
  if (greetingEl) greetingEl.textContent = greeting;

  const dateHeaderEl = $('#todayDateHeader');
  if (dateHeaderEl) {
    dateHeaderEl.textContent = DateUtil ? DateUtil.formatVietnameseDate(TODAY) : TODAY;
  }

  // Calculate plan & fixed events today
  const plan = createPlan(TODAY);
  const fixed = plan.fixed || [];
  const scheduledTasks = plan.plan || [];
  const scheduledOpenTasks = openTasks().filter(t => !InboxServiceUtil || !InboxServiceUtil.isInboxItem(t));
  const completedToday = (currentUser.sessions || []).filter(session => session.date === TODAY && session.status === 'complete');

  // Next Event
  const nextEvent = TodayEngineUtil ? TodayEngineUtil.calculateNextEvent(now, fixed, scheduledTasks) : null;
  const nextCard = $('#nextEventCard');
  if (nextCard) {
    if (nextEvent) {
      nextCard.classList.remove('clear-state');
      const badgeEl = $('#nextEventBadge');
      if (badgeEl) badgeEl.textContent = nextEvent.status === 'active' ? 'ĐANG DIỄN RA' : 'SẮP TỚI';
      const titleEl = $('#nextEventTitle');
      if (titleEl) titleEl.textContent = nextEvent.title;
      const timingEl = $('#nextEventTiming');
      if (timingEl) timingEl.textContent = `${nextEvent.start} – ${nextEvent.end}`;
      const countEl = $('#nextEventCountdown');
      if (countEl) countEl.textContent = nextEvent.status === 'active' ? `${nextEvent.minutesRemaining}m` : `${nextEvent.minutesUntil}m`;
      const countLabelEl = $('#nextEventCountdownLabel');
      if (countLabelEl) countLabelEl.textContent = nextEvent.status === 'active' ? 'kết thúc' : 'bắt đầu';
      const dotEl = $('#nextEventDot');
      if (dotEl) dotEl.style.display = nextEvent.status === 'active' ? 'inline-block' : 'none';
    } else {
      nextCard.classList.add('clear-state');
      const badgeEl = $('#nextEventBadge');
      if (badgeEl) badgeEl.textContent = 'LỊCH TRÌNH RẢNH';
      const titleEl = $('#nextEventTitle');
      if (titleEl) titleEl.textContent = 'Không còn sự kiện nào trong ngày';
      const timingEl = $('#nextEventTiming');
      if (timingEl) timingEl.textContent = 'Bạn có thể tự do học hoặc nghỉ ngơi';
      const countEl = $('#nextEventCountdown');
      if (countEl) countEl.textContent = '✦';
      const countLabelEl = $('#nextEventCountdownLabel');
      if (countLabelEl) countLabelEl.textContent = 'Thảnh thơi';
      const dotEl = $('#nextEventDot');
      if (dotEl) dotEl.style.display = 'none';
    }
  }

  // Free Time
  const freeMinutes = TodayEngineUtil
    ? TodayEngineUtil.calculateFreeTime(currentUser.availability, fixed, scheduledTasks, now)
    : 120;
  const freeHours = Math.floor(freeMinutes / 60);
  const freeRemMins = freeMinutes % 60;
  const freeTimeEl = $('#todayFreeTime');
  if (freeTimeEl) {
    freeTimeEl.textContent = `${freeHours}h ${String(freeRemMins).padStart(2, '0')}m`;
  }

  // Daily Progress
  const allTodayTasks = currentUser.tasks.filter(t => t.scheduledDate === TODAY || t.deadline === TODAY);
  const completedTodayTasks = allTodayTasks.filter(t => t.status === 'done');
  const progressObj = TodayEngineUtil
    ? TodayEngineUtil.calculateDailyProgress(allTodayTasks, completedTodayTasks)
    : { totalCount: allTodayTasks.length, completedCount: completedTodayTasks.length, percent: 0 };
  const progPctEl = $('#todayProgressPercent');
  if (progPctEl) progPctEl.textContent = `${progressObj.percent}%`;
  const progSubEl = $('#todayProgressSubtext');
  if (progSubEl) progSubEl.textContent = `${progressObj.completedCount} / ${progressObj.totalCount} việc hôm nay`;

  // Summary Line in Header Card
  const summaryEl = $('#todaySummaryText');
  if (summaryEl) {
    if (scheduledTasks.length > 0) {
      summaryEl.innerHTML = `Bạn có <strong>${scheduledTasks.length} phiên học</strong> được lên lịch hôm nay. Thời gian tự do: <strong>${freeHours}h ${freeRemMins}m</strong>.`;
    } else {
      summaryEl.textContent = 'Hôm nay chưa có lịch học cố định. Bạn có thể chọn việc từ Hộp thư hoặc thư giãn.';
    }
  }

  // Recommended Next Action
  const rec = TodayEngineUtil ? TodayEngineUtil.recommendNextAction(scheduledOpenTasks, freeMinutes, fixed) : null;
  const recBtn = $('#startRecommendedBtn');
  if (rec && rec.recommended) {
    const focus = rec.recommended;
    const subject = getSubject(focus.subjectId);
    const style = appearance(subject || { name: 'Môn khác' });
    const orbEl = $('#recommendOrb');
    if (orbEl) {
      orbEl.className = `subject-orb small ${style.orb}`;
      orbEl.textContent = style.icon;
    }
    const recTitleEl = $('#recommendTitle');
    if (recTitleEl) recTitleEl.textContent = focus.title;
    const recDurEl = $('#recommendDuration');
    if (recDurEl) recDurEl.textContent = `${focus.minutes || 30} phút`;
    const recRatEl = $('#recommendRationale');
    if (recRatEl) recRatEl.textContent = rec.rationale || 'Ưu tiên cao nhất';
    if (recBtn) {
      recBtn.disabled = false;
      recBtn.dataset.taskId = focus.id;
    }
  } else {
    const recTitleEl = $('#recommendTitle');
    if (recTitleEl) recTitleEl.textContent = 'Tất cả nhiệm vụ đã xong!';
    const recDurEl = $('#recommendDuration');
    if (recDurEl) recDurEl.textContent = '--';
    const recRatEl = $('#recommendRationale');
    if (recRatEl) recRatEl.textContent = 'Bạn không có nhiệm vụ nào cần làm gấp hôm nay.';
    if (recBtn) {
      recBtn.disabled = true;
      delete recBtn.dataset.taskId;
    }
  }

  // Attention Center
  const attentionItems = [];
  const overdueTasks = (currentUser.tasks || []).filter(t => t.status !== 'done' && t.deadline && t.deadline < TODAY);
  overdueTasks.forEach(t => {
    attentionItems.push(`<span>⚠️ Quá hạn: <strong>${escapeHTML(t.title)}</strong> (hạn: ${formatShortDate(t.deadline)})</span>`);
  });
  (currentUser.examMilestones || []).forEach(m => {
    const days = DateUtil ? DateUtil.diffAppDays(m.date, TODAY) : 99;
    if (days >= 0 && days <= 7) {
      attentionItems.push(`<span>🎯 Kỳ thi sắp tới: <strong>${escapeHTML(m.title)}</strong> (${days === 0 ? 'HÔM NAY' : days + ' ngày nữa'})</span>`);
    }
  });
  const attBanner = $('#todayAttentionBanner');
  const attList = $('#todayAttentionList');
  if (attBanner && attList) {
    if (attentionItems.length > 0) {
      attBanner.hidden = false;
      attList.innerHTML = attentionItems.map(item => `<div class="attention-item">${item}</div>`).join('');
    } else {
      attBanner.hidden = true;
    }
  }

  // Timeline
  const todayTimelineItems = [
    ...fixed.map(e => `<div class="time-entry"><time>${e.start}</time><div class="timeline-line"><span></span></div><div class="schedule-event"><p>Cố định</p><h3>${escapeHTML(e.title)}</h3><small>${e.start} – ${e.end}</small></div></div>`),
    ...completedToday.map(session => timelineSession(session, true)),
    ...scheduledTasks.map(task => timelineTask(task))
  ];
  const todayHTML = todayTimelineItems.join('') || emptyHTML('Chưa có phiên nào được lên lịch hôm nay.');

  // Upcoming Days (next 2 days)
  const upcomingDays = [];
  for (let i = 1; i <= 2; i++) {
    const ds = DateUtil ? DateUtil.addAppDays(TODAY, i) : TODAY;
    const dayOfWeek = DateUtil ? DateUtil.getAppDayOfWeek(ds) : 0;
    const futurePlan = createPlan(ds);
    if (futurePlan.plan.length || futurePlan.fixed.length) {
      upcomingDays.push({ date: ds, day: dayNames[dayOfWeek], plan: futurePlan.plan, fixed: futurePlan.fixed });
    }
  }
  const upcomingHTML = upcomingDays.map(ud => {
    const items = [
      ...ud.fixed.map(e => `<div class="time-entry"><time>${e.start}</time><div class="timeline-line"><span></span></div><div class="schedule-event"><p>Cố định</p><h3>${escapeHTML(e.title)}</h3><small>${e.start} – ${e.end}</small></div></div>`),
      ...ud.plan.map(task => timelineTask(task))
    ];
    return items.length ? `<div class="upcoming-day"><p class="eyebrow" style="margin-top:12px;margin-bottom:6px;opacity:.6">${ud.day.toUpperCase()}, ${formatShortDate(ud.date)}</p>${items.join('')}</div>` : '';
  }).join('');

  const homeTimelineEl = $('#homeTimeline');
  if (homeTimelineEl) {
    homeTimelineEl.innerHTML = todayHTML + (upcomingHTML ? `<div class="upcoming-section"><p class="eyebrow" style="margin-top:16px;margin-bottom:8px;font-weight:700;">SẮP TỚI</p>${upcomingHTML}</div>` : '');
  }
}

function renderInbox() {
  if (!currentUser) return;
  const items = InboxServiceUtil ? InboxServiceUtil.getInboxItems(currentUser.tasks) : [];
  const openItems = items.filter(t => t.status !== 'done');

  // Update badge in sidebar
  const inboxCountEl = $('#inboxCount');
  if (inboxCountEl) {
    inboxCountEl.textContent = openItems.length;
    inboxCountEl.style.display = openItems.length > 0 ? 'inline-block' : 'none';
  }

  const boardCountEl = $('#inboxItemsCount');
  if (boardCountEl) {
    boardCountEl.textContent = `${openItems.length} việc cần sắp xếp`;
  }

  const listEl = $('#inboxItemsList');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>Hộp thư đang trống! ✦ Mọi ý tưởng và bài tập đã được xếp lịch gọn gàng.</p>
        <button type="button" class="primary-button" id="emptyInboxAddBtn" style="margin-top: 10px;">+ Thêm việc mới vào Inbox</button>
      </div>
    `;
    return;
  }

  listEl.innerHTML = items.map(item => {
    const isDone = item.status === 'done';
    const itemIdEsc = escapeHTML(item.id);
    const duration = item.minutes || 30;
    const isHigh = item.priority >= 4;
    return `
      <div class="inbox-item-card ${isDone ? 'done' : ''}" data-inbox-id="${itemIdEsc}">
        <div class="inbox-item-main">
          <button type="button" class="inbox-item-check ${isDone ? 'checked' : ''}" data-inbox-check="${itemIdEsc}" aria-label="Hoàn thành">${isDone ? '✓' : ''}</button>
          <div class="inbox-item-details">
            <h4 class="inbox-item-title ${isDone ? 'strikethrough' : ''}">${escapeHTML(item.title)}</h4>
            <div class="inbox-item-meta">
              <span class="duration-tag">⏱ ${duration}p</span>
              <span class="qc-badge ${isHigh ? 'priority-high' : 'priority-normal'}">${isHigh ? 'Ưu tiên cao (!)' : 'Bình thường'}</span>
              <span>Tạo: ${formatShortDate(item.createdAt || TODAY)}</span>
            </div>
          </div>
        </div>
        <div class="inbox-actions-group">
          <button type="button" class="inbox-action-btn" data-inbox-schedule="${itemIdEsc}" title="Xếp vào hôm nay">📅 Hôm nay</button>
          <button type="button" class="inbox-action-btn" data-inbox-tomorrow="${itemIdEsc}" title="Xếp vào ngày mai">⏩ Ngày mai</button>
          <button type="button" class="inbox-action-btn" data-open-task="${itemIdEsc}" title="Chỉnh sửa">✏ Sửa</button>
          <button type="button" class="inbox-action-btn danger" data-inbox-delete="${itemIdEsc}" title="Xóa">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}
function taskHTML(task) {
  const subject = getSubject(task.subjectId); const style = appearance(subject || { name: 'Môn khác' }); const done = task.status === 'done';
  const meta = done ? { score: 0, label: 'Hoàn thành', cssClass: 'regular' } : taskPriorityMeta(task);
  const reason = done ? 'Đã hoàn thành' : `${meta.score} điểm · ${describePriorityReason(task)}`;
  const taskIdEsc = escapeHTML(task.id);
  return `<article class="task-row ${done ? 'done' : ''} ${meta.score >= 80 && !done ? 'task-highlight' : ''}" data-task-id="${taskIdEsc}"><button class="check-button ${done ? 'checked' : ''}" data-toggle-task="${taskIdEsc}" aria-label="Đổi trạng thái nhiệm vụ"></button><div class="task-category ${style.category}">${escapeHTML(style.badge)}</div><button class="task-main task-open" data-open-task="${taskIdEsc}"><h3>${escapeHTML(task.title)}</h3><p><span class="tiny-calendar">□</span>${done ? 'Đã hoàn thành' : deadlineText(task.deadline)} <i>•</i>${escapeHTML(reason)}</p></button><span class="priority-label ${done ? 'regular' : meta.cssClass}">${done ? 'Hoàn thành' : meta.label}</span><button class="task-arrow" data-open-task="${taskIdEsc}" aria-label="Chỉnh sửa nhiệm vụ">→</button></article>`;
}
function renderSubjectProgress() {
  const cards = getSubjectProgressCards(3);
  $('#subjectProgress').innerHTML = cards.length ? cards.map(subject => {
    const style = appearance(subject);
    const average = Math.max(0, Math.min(100, Number(subject.average) || 0));
    const statusText = average >= 70 ? '↑ Tiến bộ' : average >= 45 ? 'Đang cải thiện' : 'Cần ưu tiên';
    const target = subject.target || `${subject.topicsCount || 0} chủ đề đang theo dõi`;
    return `<article class="subject-progress-card ${style.card}"><div class="subject-card-top"><span class="subject-orb small ${style.orb}">${escapeHTML(style.icon)}</span><span class="trend ${average >= 70 ? 'up' : 'neutral'}">${statusText}</span></div><h3>${escapeHTML(subject.name)}</h3><p class="subject-card-target">${escapeHTML(target)}</p><div class="progress-line"><span style="width:${average}%"></span></div><strong>${average}% <small>nắm vững</small></strong></article>`;
  }).join('') : emptyHTML('Thêm môn học đầu tiên để bắt đầu theo dõi tiến độ.');
}
function timelineTask(task) { const subject = getSubject(task.subjectId); return `<div class="time-entry current"><time>${task.start || '—'}</time><div class="timeline-line"><span></span></div><div class="schedule-event"><p>TB đề xuất · ${escapeHTML(subject?.name || 'Tự học')}</p><h3>${escapeHTML(task.title)}</h3><small>${task.minutes} phút</small></div></div>`; }
function timelineSession(session, complete) { const topic = getTopic(session.topicId); return `<div class="time-entry ${complete ? 'done' : ''}"><time>Đã xong</time><div class="timeline-line"><span></span></div><div class="schedule-event"><p>${complete ? 'Đã hoàn thành' : 'Đã ghi nhận'} · ${escapeHTML(topic?.subject.name || 'Tự học')}</p><h3>${escapeHTML(topic?.name || 'Phiên học')}</h3><small>${session.minutes} phút</small></div></div>`; }
function renderSchedule() {
  const schedDateLabel = $('.date-navigator strong');
  if (schedDateLabel) schedDateLabel.textContent = DateUtil ? DateUtil.formatScheduleHeaderDate(scheduleViewDate) : scheduleViewDate;
  const { fixed, plan, capacity } = createPlan(scheduleViewDate); const all = [...fixed.map(item => ({ ...item, flexible: false, sortStart: item.start })), ...plan.map(item => ({ ...item, flexible: true, sortStart: item.start }))].sort((a, b) => a.sortStart.localeCompare(b.sortStart));
  $('#scheduleCapacity').textContent = `Còn ${formatMinutes(Math.max(0, capacity - plan.reduce((sum, task) => sum + task.minutes, 0)))} linh hoạt`;
  const applied = currentUser.lastSimulation ? `<div class="active-plan-banner"><span>✓</span><span><b>Phương án mới đang áp dụng.</b> ${escapeHTML(currentUser.lastSimulation.summary)}</span></div>` : '';
  $('#scheduleTimeline').innerHTML = applied + (all.length ? all.map(event => `<article class="day-schedule-event ${event.flexible ? 'flexible' : 'fixed'}"><time>${event.start} – ${event.end || event.endTime || timeFromMin(minFromTime(event.start) + Number(event.minutes || 0))}</time><span class="event-rail"></span><div><h3>${escapeHTML(event.title)}</h3><p>${event.flexible ? `Tự học · ${escapeHTML(getSubject(event.subjectId)?.name || '')} · ${event.minutes} phút` : `${event.type === 'school' ? 'Trường học' : event.type === 'tutoring' ? 'Học thêm' : 'Hoạt động cá nhân'} · được bảo toàn${event.isModifiedOccurrence ? ' (đã chỉnh giờ)' : ''}`}</p></div>${!event.flexible ? `<button class="text-button mini-skip-btn" data-skip-occurrence="${event.seriesId || event.id}" data-occurrence-date="${scheduleViewDate}" title="Bỏ qua ca này trong ngày ${scheduleViewDate}">Bỏ qua hôm nay</button>` : ''}<span class="event-tag">${event.flexible ? 'Linh hoạt' : 'Cố định'}</span></article>`).join('') : emptyHTML('Chưa có lịch cố định hay nhiệm vụ mở.'));
  const highest = plan[0]; const topic = highest ? getTopic(highest.topicId) : null;
  $('#scheduleReasonTitle').textContent = highest ? `${highest.title} được ưu tiên trước.` : 'Hãy thêm dữ liệu để TB sắp lịch.';
  $('#scheduleReason').textContent = highest ? `${highest.deadline === TODAY ? 'Hạn chót là hôm nay. ' : ''}${topic ? `${topic.name} đang ở mức ${topic.mastery}% nắm vững. ` : ''}Phiên này vừa khít trong khung giờ rảnh và không chạm vào lịch cố định.` : 'TB cần ít nhất một nhiệm vụ, môn học và khung giờ rảnh để tạo một lịch có lý do.';
  $('#fixedSchedulesList').innerHTML = currentUser.fixedSchedules.length ? currentUser.fixedSchedules.map(event => {
    const excCount = Array.isArray(event.exceptions) ? event.exceptions.length : 0;
    const excLabel = excCount > 0 ? `<span class="rec-exc-badge" title="${excCount} ngoại lệ">${excCount} ngoại lệ</span>` : '';
    return `<article class="fixed-schedule-card"><button data-delete-fixed="${event.id}" aria-label="Xoá ${escapeHTML(event.title)}">×</button><p>${dayNames[event.day].toUpperCase()} · ${event.type === 'school' ? 'TRƯỜNG HỌC' : event.type === 'tutoring' ? 'HỌC THÊM' : 'CÁ NHÂN'} ${excLabel}</p><h3>${escapeHTML(event.title)}</h3><small>${event.start} – ${event.end}</small></article>`;
  }).join('') : emptyHTML('Chưa có lịch cố định.');
  normalizeScheduleState();
  const existingHistory = $('#changeHistoryDynamic');
  if (existingHistory) existingHistory.remove();
  const activeChanges = currentUser.scheduleChanges.filter(change => change.status === 'replacement-active' || change.status === 'original-restored');
  if (activeChanges.length) {
    const history = document.createElement('section');
    history.id = 'changeHistoryDynamic';
    history.className = 'change-history';
    history.innerHTML = `<div class="section-heading"><div><p class="eyebrow">THAY ĐỔI ĐÃ LƯU</p><h2>Lịch gốc và lịch thay thế</h2></div></div><div class="change-history-list">${activeChanges.map(change => { const original = change.original.map(item => `${dayNames[item.day]} ${item.start}–${item.end}`).join(', '); const replacement = (change.replacement || change.restored || []).map(item => `${dayNames[item.day]} ${item.start}–${item.end}`).join(', '); return `<article class="change-history-card"><span class="history-icon">↺</span><div><strong>${escapeHTML(change.original[0]?.title || 'Lịch đã thay đổi')}</strong><p>Gốc: ${escapeHTML(original)}<br>${change.status === 'replacement-active' ? `Thay thế: ${escapeHTML(replacement)}` : 'Đã khôi phục lịch gốc'}</p></div>${change.status === 'replacement-active' ? `<button class="soft-button" data-restore-schedule="${change.id}">Hoàn tác</button>` : '<span class="history-status">Đã hoàn tác</span>'}</article>`; }).join('')}</div>`;
    $('#fixedSchedulesList').insertAdjacentElement('afterend', history);
  }
}
function renderSubjects() {
  $('#subjectLibrary').innerHTML = currentUser.subjects.length ? currentUser.subjects.map(subject => { const style = appearance(subject); const average = subjectAverage(subject); return `<article class="subject-editor-card"><div class="subject-editor-summary"><span class="subject-orb ${style.orb}">${style.icon}</span><p class="eyebrow">${average}% NẮM VỮNG</p><h3>${escapeHTML(subject.name)}</h3><p>${escapeHTML(subject.target || 'Chưa đặt mục tiêu môn học')}</p></div><div class="subject-editor-content"><header><p>${subject.topics.length ? 'Chỉnh sửa từng chủ đề để TB biết phần nào cần được ưu tiên.' : 'Thêm chủ đề đầu tiên để bắt đầu theo dõi.'}</p><button class="mini-action" data-edit-subject="${subject.id}">Chỉnh sửa môn</button></header>${subject.topics.map(topic => { const [status, statusClass] = masteryStatus(topic.mastery); return `<div class="topic-editor-row"><b>${escapeHTML(topic.name)}</b><strong>${topic.mastery}%</strong><small class="${statusClass}">● ${status}</small><button class="task-arrow" data-edit-topic="${topic.id}" data-subject-id="${subject.id}" aria-label="Chỉnh sửa ${escapeHTML(topic.name)}">→</button></div>`; }).join('')}<button class="mini-action" data-add-topic="${subject.id}">+ Thêm chủ đề</button></div></article>`; }).join('') : '<div class="empty-library">Bạn chưa có môn học. Hãy thêm môn đầu tiên để TB có cơ sở xây lịch.</div>';
}
function renderProgress() {
  const completed = currentUser.sessions.filter(session => session.status === 'complete'); const minutes = completed.reduce((sum, session) => sum + Number(session.minutes), 0);
  $('#studyMinutes').textContent = formatMinutes(minutes); $('#studyTrend').textContent = completed.length ? `Dựa trên ${completed.length} phiên hoàn thành đã lưu` : 'Chưa có phiên hoàn thành';
  const todayWeekday = DateUtil ? DateUtil.getAppDayOfWeek(TODAY) : new Date().getDay();
  const weekdayMinutes = [1, 2, 3, 4, 5, 6, 0].map(day => {
    const diff = day - todayWeekday;
    const targetDate = DateUtil ? DateUtil.addAppDays(TODAY, diff + (diff > 0 ? -7 : 0)) : TODAY;
    return completed.filter(session => session.date === targetDate).reduce((sum, session) => sum + session.minutes, 0);
  });
  const max = Math.max(...weekdayMinutes, 60);
  $('#barChart').innerHTML = weekdayMinutes.map((value, index) => `<i style="height:${Math.max(8, Math.round((value / max) * 100))}%" title="${value} phút"></i>`).join('');
  const review = currentUser.reviewSchedules.filter(item => item.status === 'scheduled').sort((a, b) => a.due.localeCompare(b.due))[0]; const topic = review ? getTopic(review.topicId) : null;
  if (topic) { $('#reviewTopic').textContent = topic.name; $('#retentionValues').innerHTML = `<span>Trước học<b>${topic.quiz?.before ?? '—'}/10</b></span><i></i><span>Sau học<b>${topic.quiz?.after ?? '—'}/10</b></span><i></i><span>Sau ${review.interval} ngày<b>${topic.quiz?.retention ?? '—'}/10</b></span>`; $('#reviewNote').innerHTML = dateFrom(review.due) <= dateFrom(TODAY) ? `Đến lịch ôn lại hôm nay. TB đặt lần ôn này sau <strong>${review.interval} ngày</strong> vì đó là khoảng cách đã lưu từ phiên trước.` : `Lần ôn kế tiếp: <strong>${formatShortDate(review.due)}</strong>. Khoảng cách hiện tại là ${review.interval} ngày.`; $('#reviewNote').insertAdjacentHTML('beforeend', ` <button class="soft-button" data-complete-review="${review.id}">Đánh dấu đã ôn xong</button>`); } else { $('#reviewTopic').textContent = 'Chưa có lịch ôn'; $('#retentionValues').innerHTML = '<span>Hãy hoàn thành một phiên học để TB tạo lịch ôn.</span>'; $('#reviewNote').textContent = 'Spaced repetition sẽ thay đổi khoảng cách theo mức độ hiểu bạn ghi nhận.'; }
  $('#sessionLog').innerHTML = currentUser.sessions.length ? [...currentUser.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(session => { const topic = getTopic(session.topicId); return `<article class="session-log-row"><time>${formatShortDate(session.date)}</time><div><h3>${escapeHTML(topic?.name || 'Chủ đề đã xoá')}</h3><p>${escapeHTML(topic?.subject.name || 'Không rõ môn')} · ${session.status === 'complete' ? `Hiểu ${session.understanding || 0}/5` : 'Đã bỏ lỡ'}</p></div><strong>${session.status === 'complete' ? `${session.minutes}p` : 'Bỏ lỡ'}</strong></article>`; }).join('') : emptyHTML('Chưa có lịch sử. Hãy ghi nhanh một phiên học.');
}
function renderTasks() {
  const source = taskFilter === 'all' ? currentUser.tasks : currentUser.tasks.filter(task => taskFilter === 'done' ? task.status === 'done' : task.status !== 'done');
  $('#taskBoardItems').innerHTML = source.length ? [...source].sort((a, b) => taskScore(b) - taskScore(a)).map(taskHTML).join('') : emptyHTML(taskFilter === 'done' ? 'Chưa có nhiệm vụ hoàn thành.' : 'Không có nhiệm vụ ở trạng thái này.');
  $('#taskBoardCount').textContent = `${openTasks().length} nhiệm vụ đang mở · ${currentUser.tasks.filter(task => task.status === 'done').length} đã hoàn thành`;
  $('#taskCount').textContent = openTasks().length;
  $$('.filter-chip').forEach(button => button.classList.toggle('active', button.dataset.filter === taskFilter));
}
function renderInsights() {
  const insights = derivedInsights(); $('#insightsList').innerHTML = insights.map((insight, index) => `<article><span class="insight-number">0${index + 1}</span><div><p class="insight-source">${escapeHTML(insight.source)}</p><h3>${escapeHTML(insight.title)}</h3><p>${escapeHTML(insight.body)}</p></div><button class="soft-button insight-action" data-insight-page="${insight.page}">${escapeHTML(insight.action)}</button></article>`).join('');
  const coach = insights[0]; $('#coachTitle').textContent = coach.title; $('#coachText').textContent = coach.body; $('#coachCard').style.display = currentUser.settings.coach ? '' : 'none';
}
function renderSettings() {
  const subjectCount = currentUser.subjects.length; const availability = `${currentUser.availability.start} – ${currentUser.availability.end} · ${currentUser.availability.days.length} ngày/tuần`;
  $('#settingsList').innerHTML = `<article><span class="settings-icon">◉</span><div><h3>Hồ sơ học tập</h3><p>${escapeHTML(currentUser.profile.name)} · ${escapeHTML(currentUser.profile.grade || 'Chưa chọn lớp')}</p><span class="settings-value">${escapeHTML(currentUser.profile.goal || 'Chưa đặt mục tiêu chính')}</span></div><button class="soft-button" data-settings-action="profile">Chỉnh sửa</button></article><article><span class="settings-icon">◷</span><div><h3>Khoảng thời gian tự học</h3><p>TB chỉ xếp phiên linh hoạt vào khoảng này</p><span class="settings-value">${availability}</span></div><button class="soft-button" data-settings-action="availability">Chỉnh sửa</button></article><article><span class="settings-icon">▦</span><div><h3>Môn học và chủ đề</h3><p>${subjectCount} môn · ${currentUser.subjects.reduce((sum, subject) => sum + subject.topics.length, 0)} chủ đề đang theo dõi</p><span class="settings-value">Cấu hình Knowledge Map</span></div><button class="soft-button" data-settings-action="subjects">Quản lý</button></article><article><span class="settings-icon">♢</span><div><h3>Nhắc lịch học</h3><p>Nhắc trước mỗi phiên học 10 phút</p><span class="settings-value">${currentUser.settings.reminders ? 'Đang bật' : 'Đang tắt'}</span></div><label class="switch"><input id="reminderToggle" type="checkbox" ${currentUser.settings.reminders ? 'checked' : ''}><span></span></label></article><article><span class="settings-icon">✦</span><div><h3>Study Coach</h3><p>Hiển thị insight rút ra từ dữ liệu đã lưu</p><span class="settings-value">${currentUser.settings.coach ? 'Đang bật' : 'Đang tắt'}</span></div><label class="switch"><input id="coachToggle" type="checkbox" ${currentUser.settings.coach ? 'checked' : ''}><span></span></label></article>`;
}
function emptyHTML(message) { return `<div class="empty-state">${escapeHTML(message)}</div>`; }

/* --- Exam Countdown & Milestones --- */
function renderExamCountdown() {
  const milestones = (currentUser.examMilestones || []).filter(m => m && m.date);
  const upcoming = milestones
    .filter(m => normalizeDateInput(m.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const banner = $('#examCountdownBanner');
  if (!banner) return;

  const nearest = upcoming[0];
  const daysEl = $('#countdownDaysNumber');
  if (!nearest) {
    $('#countdownExamTitle').textContent = 'Chưa có kỳ thi nào';
    $('#countdownExamSubjects').textContent = 'Nhấp "Xem lịch thi" để thêm kỳ thi quan trọng';
    daysEl.textContent = '—';
    daysEl.className = 'muted';
    if (daysEl.nextElementSibling) daysEl.nextElementSibling.textContent = 'chưa có ngày';
    return;
  }

  const diffDays = calculateDaysUntil(nearest.date);
  $('#countdownExamTitle').textContent = nearest.title || 'Kỳ thi mới';
  $('#countdownExamSubjects').textContent = nearest.subjects || 'Tất cả các môn thi';

  if (diffDays === null) {
    daysEl.textContent = '—';
    daysEl.className = 'muted';
    if (daysEl.nextElementSibling) daysEl.nextElementSibling.textContent = 'chưa có ngày';
    return;
  }

  if (diffDays <= 0) {
    daysEl.textContent = '0';
    daysEl.className = 'urgent';
    if (daysEl.nextElementSibling) daysEl.nextElementSibling.textContent = 'hôm nay!';
  } else {
    daysEl.textContent = String(diffDays);
    daysEl.className = diffDays <= 14 ? 'urgent' : '';
    if (daysEl.nextElementSibling) daysEl.nextElementSibling.textContent = 'ngày nữa';
  }
}

function renderMilestonesModal() {
  const listEl = $('#milestonesList');
  if (!listEl) return;
  const list = currentUser.examMilestones || [];
  if (!list.length) {
    listEl.innerHTML = emptyHTML('Chưa có kỳ thi nào trong danh sách.');
    return;
  }

  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  listEl.innerHTML = sorted.map(m => {
    const diff = Math.round((dateFrom(m.date) - dateFrom(TODAY)) / 86400000);
    const badgeText = diff < 0 ? 'Đã qua' : diff === 0 ? 'Hôm nay' : `${diff} ngày`;
    const isUrgent = diff >= 0 && diff <= 14;
    return `
      <div class="milestone-item">
        <div class="milestone-left">
          <span class="milestone-badge ${isUrgent ? 'urgent' : ''}">${badgeText}</span>
          <div class="milestone-info">
            <h4>${escapeHTML(m.title)}</h4>
            <p>${formatShortDate(m.date)} · ${escapeHTML(m.subjects || 'Tất cả các môn')}</p>
          </div>
        </div>
        <button type="button" class="milestone-del" data-delete-milestone="${m.id}" aria-label="Xóa kỳ thi">×</button>
      </div>
    `;
  }).join('');
}

function addMilestone(event) {
  event.preventDefault();
  const title = $('#milestoneName').value.trim();
  const date = $('#milestoneDate').value;
  const subjects = $('#milestoneSubjects').value.trim();

  if (!title || !date) {
    toast('Vui lòng nhập tên kỳ thi và ngày diễn ra.');
    return;
  }

  currentUser.examMilestones = currentUser.examMilestones || [];
  currentUser.examMilestones.push({
    id: uid('milestone'),
    title,
    date,
    subjects: subjects || 'Tất cả các môn'
  });

  persist();
  renderExamCountdown();
  renderMilestonesModal();
  $('#milestoneName').value = '';
  $('#milestoneDate').value = '';
  $('#milestoneSubjects').value = '';
  toast('Đã thêm kỳ thi vào lịch và kích hoạt đếm ngược!');
}

function deleteMilestone(id) {
  currentUser.examMilestones = (currentUser.examMilestones || []).filter(m => m.id !== id);
  persist();
  renderExamCountdown();
  renderMilestonesModal();
  toast('Đã xóa kỳ thi.');
}

/* --- Take Note & Photo Lesson Log with Spaced Repetition --- */
let currentNotePhotoData = null;

function openTakeNoteModal() {
  const select = $('#takeNoteSubject');
  select.innerHTML = currentUser.subjects.length
    ? currentUser.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('')
    : '<option value="">(Chưa có môn học)</option>';
  $('#takeNoteTopic').value = '';
  $('#takeNoteContent').value = '';
  $('#takeNoteUnderstanding').value = '3';
  currentNotePhotoData = null;
  $('#notePhotoInput').value = '';
  $('#notePhotoImg').src = '';
  $('#photoPlaceholder').hidden = false;
  $('#photoPreviewContainer').hidden = true;
  openModal('takeNoteModal');
}

function processNotePhoto(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('Vui lòng chọn tệp hình ảnh (JPG, PNG, WebP).');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      currentNotePhotoData = canvas.toDataURL('image/jpeg', 0.8);
      $('#notePhotoImg').src = currentNotePhotoData;
      $('#photoPlaceholder').hidden = true;
      $('#photoPreviewContainer').hidden = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function saveTakeNote(event) {
  event.preventDefault();
  const subjectId = $('#takeNoteSubject').value;
  const topicName = $('#takeNoteTopic').value.trim();
  const noteText = $('#takeNoteContent').value.trim();
  const understanding = Number($('#takeNoteUnderstanding').value);

  if (!subjectId || !topicName) {
    toast('Vui lòng chọn môn học và nhập tên bài học.');
    return;
  }

  const interval = getReviewIntervalByUnderstanding(understanding);
  const nextReviewDate = relDate(interval);

  const subject = getSubject(subjectId);
  let topic = subject?.topics.find(t => t.name.toLowerCase() === topicName.toLowerCase());
  if (!topic && subject) {
    topic = { id: uid('topic'), name: topicName, mastery: Math.min(100, understanding * 20), quiz: {} };
    subject.topics.push(topic);
  }

  const newNote = {
    id: uid('note'),
    subjectId,
    topicName,
    noteText,
    photoUrl: currentNotePhotoData,
    understanding,
    createdAt: TODAY,
    interval,
    nextReviewDate,
    reviewed: false
  };

  currentUser.studyNotes = currentUser.studyNotes || [];
  currentUser.studyNotes.unshift(newNote);

  if (topic) {
    scheduleReviewForTopic(topic.id, understanding, {
      days: interval,
      extra: { noteId: newNote.id }
    });

    currentUser.tasks.unshift({
      id: uid('task-review'),
      subjectId,
      topicId: topic.id,
      title: `Ôn tập: ${topicName} (từ Take Note)`,
      minutes: 30,
      priority: understanding <= 2 ? 5 : 4,
      deadline: nextReviewDate,
      status: 'open',
      createdAt: TODAY
    });
  }

  persist();
  renderApp();
  closeModal('takeNoteModal');
  toast(`Đã lưu bài học! TB sẽ tự động nhắc bạn ôn lại vào ${formatShortDate(nextReviewDate)}.`);
}

function deleteTakeNote(id) {
  currentUser.studyNotes = (currentUser.studyNotes || []).filter(n => n.id !== id);
  currentUser.reviewSchedules = (currentUser.reviewSchedules || []).filter(r => r.noteId !== id);
  persist();
  renderTakeNotes();
  toast('Đã xóa ghi chú bài học.');
}

function renderTakeNotes() {
  const container = $('#takeNotesList');
  if (!container) return;
  const notes = currentUser.studyNotes || [];
  if (!notes.length) {
    container.innerHTML = `
      <div class="take-note-empty">
        <span style="font-size: 28px; display: block; margin-bottom: 6px;">📸</span>
        <b>Chưa có ghi chú bài học nào</b>
        <p>Hôm nay học đến đâu? Chụp ảnh vở hoặc bài tập để TB tự động lên lịch nhắc ôn thông minh!</p>
        <button type="button" class="primary-button" id="emptyAddNoteBtn">+ Chụp bài học hôm nay <span>📸</span></button>
      </div>
    `;
    const btn = $('#emptyAddNoteBtn');
    if (btn) btn.addEventListener('click', openTakeNoteModal);
    return;
  }

  container.innerHTML = notes.map(note => {
    const subject = getSubject(note.subjectId) || { name: 'Môn học', color: 'custom' };
    const style = appearance(subject);
    const isDue = note.nextReviewDate && dateFrom(note.nextReviewDate) <= dateFrom(TODAY);
    const diff = note.nextReviewDate ? Math.round((dateFrom(note.nextReviewDate) - dateFrom(TODAY)) / 86400000) : 0;

    let reviewTagHTML = '';
    if (note.nextReviewDate) {
      if (isDue) {
        reviewTagHTML = `<span class="review-tag due">🔔 Cần ôn hôm nay</span>`;
      } else {
        reviewTagHTML = `<span class="review-tag scheduled">✦ Ôn sau ${diff} ngày (${formatShortDate(note.nextReviewDate)})</span>`;
      }
    }

    const photoHTML = note.photoUrl ? `
      <div class="take-note-thumb-wrap" data-zoom-photo="${escapeHTML(note.photoUrl)}">
        <img class="take-note-img" src="${escapeHTML(note.photoUrl)}" alt="Ảnh bài học" />
      </div>
    ` : '';

    return `
      <article class="take-note-card">
        ${photoHTML}
        <div class="take-note-head">
          <span class="subject-orb small ${style.orb}">${style.icon}</span>
          <span class="take-note-date">${formatShortDate(note.createdAt)}</span>
        </div>
        <h3>${escapeHTML(note.topicName)}</h3>
        <p>${escapeHTML(note.noteText || 'Không có ghi chú thêm.')}</p>
        <div class="take-note-footer">
          ${reviewTagHTML}
          <button type="button" class="take-note-del-btn" data-delete-note="${note.id}" aria-label="Xóa ghi chú">×</button>
        </div>
      </article>
    `;
  }).join('');
}

function openPhotoLightbox(src) {
  if (!isSafeImageUrl(src)) return;
  const existing = $('.lightbox-modal');
  if (existing) existing.remove();
  const box = document.createElement('div');
  box.className = 'lightbox-modal';
  const img = document.createElement('img');
  img.src = src;
  img.alt = 'Ảnh bài học phóng to';
  const closeBtn = document.createElement('span');
  closeBtn.style.cssText = 'position:absolute;top:20px;right:25px;color:#fff;font-size:32px;cursor:pointer;line-height:1;';
  closeBtn.textContent = '×';
  box.appendChild(img);
  box.appendChild(closeBtn);
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

/* --- Timetable Import (DOCX / Image / Text) --- */
let parsedImportSlots = [];
let detectedMultiClasses = null;
let selectedImportClassName = null;

const PERIOD_TIMES = {
  1: { start: '07:15', end: '08:00' },
  2: { start: '08:05', end: '08:50' },
  3: { start: '09:05', end: '09:50' },
  4: { start: '09:55', end: '10:40' },
  5: { start: '10:45', end: '11:30' },
  6: { start: '13:00', end: '13:45' },
  7: { start: '13:50', end: '14:35' },
  8: { start: '14:50', end: '15:35' },
  9: { start: '15:40', end: '16:25' },
  10: { start: '16:30', end: '17:15' },
};

function parseSubjectAndTeacher(raw) {
  if (!raw) return null;
  const str = raw.trim().replace(/\s+/g, ' ');
  if (!str || str.toLowerCase() === 'nghỉ' || str === '-' || str === 'x' || str.length < 2) return null;

  let subjectPart = str;
  let teacherPart = '';

  const dashIdx = str.indexOf('-');
  if (dashIdx > 0) {
    subjectPart = str.slice(0, dashIdx).trim();
    teacherPart = str.slice(dashIdx + 1).trim();
  }

  const sLower = subjectPart.toLowerCase();
  let cleanSubject = subjectPart;
  let subjectGroup = 'Toán';

  if (sLower === 'chào cờ') {
    cleanSubject = 'Chào cờ';
    subjectGroup = 'Chào cờ';
  } else if (sLower.startsWith('shl') || sLower.includes('sinh hoạt')) {
    cleanSubject = 'Sinh hoạt lớp';
    subjectGroup = 'Sinh hoạt lớp';
  } else if (sLower.startsWith('hđtn') || sLower.includes('trải nghiệm')) {
    cleanSubject = 'HĐ Trải nghiệm';
    subjectGroup = 'Hoạt động trải nghiệm';
  } else if (sLower.startsWith('cđtoán') || sLower.startsWith('cđ toán')) {
    cleanSubject = 'Chuyên đề Toán';
    subjectGroup = 'Toán';
  } else if (sLower.startsWith('cđanh') || sLower.startsWith('cđ anh')) {
    cleanSubject = 'Chuyên đề Tiếng Anh';
    subjectGroup = 'Tiếng Anh';
  } else if (sLower.startsWith('cđvăn') || sLower.startsWith('cđ văn')) {
    cleanSubject = 'Chuyên đề Ngữ văn';
    subjectGroup = 'Ngữ văn';
  } else if (sLower.startsWith('cđlý') || sLower.startsWith('cđ lý')) {
    cleanSubject = 'Chuyên đề Vật lí';
    subjectGroup = 'Vật lí';
  } else if (sLower.startsWith('cđhóa') || sLower.startsWith('cđ hóa')) {
    cleanSubject = 'Chuyên đề Hóa học';
    subjectGroup = 'Hóa học';
  } else if (sLower.startsWith('cđsinh') || sLower.startsWith('cđ sinh')) {
    cleanSubject = 'Chuyên đề Sinh học';
    subjectGroup = 'Sinh học';
  } else if (sLower.startsWith('cđsử') || sLower.startsWith('cđ sử')) {
    cleanSubject = 'Chuyên đề Lịch sử';
    subjectGroup = 'Lịch sử';
  } else if (sLower.startsWith('cđđịa') || sLower.startsWith('cđ địa')) {
    cleanSubject = 'Chuyên đề Địa lí';
    subjectGroup = 'Địa lí';
  } else if (sLower === 'toán' || sLower === 'toan') {
    cleanSubject = 'Toán';
    subjectGroup = 'Toán';
  } else if (sLower === 'văn' || sLower === 'ngữ văn' || sLower === 'van') {
    cleanSubject = 'Ngữ văn';
    subjectGroup = 'Ngữ văn';
  } else if (sLower === 'anh' || sLower === 'tiếng anh' || sLower === 'en') {
    cleanSubject = 'Tiếng Anh';
    subjectGroup = 'Tiếng Anh';
  } else if (sLower === 'lý' || sLower === 'vật lí' || sLower === 'vật lý') {
    cleanSubject = 'Vật lí';
    subjectGroup = 'Vật lí';
  } else if (sLower === 'hóa' || sLower === 'hóa học') {
    cleanSubject = 'Hóa học';
    subjectGroup = 'Hóa học';
  } else if (sLower === 'sinh' || sLower === 'sinh học') {
    cleanSubject = 'Sinh học';
    subjectGroup = 'Sinh học';
  } else if (sLower === 'sử' || sLower === 'lịch sử') {
    cleanSubject = 'Lịch sử';
    subjectGroup = 'Lịch sử';
  } else if (sLower === 'địa' || sLower === 'địa lí' || sLower === 'địa lý') {
    cleanSubject = 'Địa lí';
    subjectGroup = 'Địa lí';
  } else if (sLower === 'tin' || sLower === 'tin học') {
    cleanSubject = 'Tin học';
    subjectGroup = 'Tin học';
  } else if (sLower.includes('gdkt') || sLower.includes('pl') || sLower === 'gdcd') {
    cleanSubject = 'GDCD / KT&PL';
    subjectGroup = 'GDCD';
  } else if (sLower === 'qp' || sLower.includes('quốc phòng')) {
    cleanSubject = 'Giáo dục quốc phòng';
    subjectGroup = 'Thể dục / GDQP';
  } else if (sLower === 'td' || sLower.includes('thể dục')) {
    cleanSubject = 'Thể dục';
    subjectGroup = 'Thể dục / GDQP';
  } else if (sLower.includes('công nghệ') || sLower === 'cn') {
    cleanSubject = 'Công nghệ';
    subjectGroup = 'Công nghệ';
  }

  const title = teacherPart ? `${cleanSubject} (GV ${teacherPart})` : cleanSubject;
  return { subject: cleanSubject, subjectGroup, teacher: teacherPart, title };
}

function normalizeSubjectName(str) {
  const parsed = parseSubjectAndTeacher(str);
  return parsed ? parsed.title : null;
}

function mergeConsecutiveSlots(slots) {
  if (!slots.length) return [];
  slots.sort((a, b) => a.day !== b.day ? a.day - b.day : minFromTime(a.start) - minFromTime(b.start));
  const merged = [];
  for (const slot of slots) {
    const last = merged[merged.length - 1];
    if (last && last.day === slot.day && last.title === slot.title && minFromTime(slot.start) <= minFromTime(last.end) + 25) {
      last.end = slot.end;
      if (last.period && slot.period) {
        last.periodLabel = `Tiết ${last.period}-${slot.period}`;
      }
    } else {
      merged.push({
        ...slot,
        periodLabel: slot.period ? `Tiết ${slot.period}` : ''
      });
    }
  }
  return merged;
}

function openTimetableModal() {
  parsedImportSlots = [];
  detectedMultiClasses = null;
  selectedImportClassName = null;
  $('#timetableFileInput').value = '';
  $('#importStatus').hidden = true;
  $('#importPreview').hidden = true;
  $('#classPickerBox').hidden = true;
  $('#timetableDropzone').hidden = false;
  openModal('importTimetableModal');
}

async function handleTimetableFile(file) {
  if (!file) return;
  $('#timetableDropzone').hidden = true;
  $('#importStatus').hidden = false;
  $('#importPreview').hidden = true;
  $('#classPickerBox').hidden = true;
  $('#importStatusText').textContent = `Đang bóc tách thời khóa biểu từ "${file.name}"...`;

  try {
    const ext = file.name.split('.').pop().toLowerCase();
    let slots = [];

    if (ext === 'docx') {
      slots = await parseDocxTimetable(file);
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      slots = await parseImageTimetable(file);
    } else {
      const text = await file.text();
      slots = parseTextTimetable(text);
    }

    if (!detectedMultiClasses) {
      parsedImportSlots = slots;
      $('#parsedClassLabel').textContent = '';
      $('#classPickerBox').hidden = true;
      renderImportPreview();
    }
  } catch (err) {
    console.error('Lỗi khi đọc file TKB:', err);
    $('#importStatus').hidden = true;
    $('#timetableDropzone').hidden = false;
    toast(err.message || 'Không thể đọc tệp này. Vui lòng thử tệp khác.');
  }
}

function extractDocxTables(xmlText) {
  const tableMatches = xmlText.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) || [];
  return tableMatches.map(tbl => {
    const rowMatches = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    return rowMatches.map(tr => {
      const cellMatches = tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      return cellMatches.map(tc => {
        const textMatches = tc.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        return textMatches.map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
      });
    });
  });
}

async function parseDocxTimetable(file) {
  if (typeof JSZip === 'undefined') {
    throw new Error('Đang tải thư viện xử lý Word, vui lòng kiểm tra kết nối và thử lại.');
  }

  let arrayBuffer;
  if (file.arrayBuffer) {
    arrayBuffer = await file.arrayBuffer();
  } else {
    arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch (zErr) {
    if (file.name.toLowerCase().endsWith('.doc')) {
      throw new Error('Tệp Word định dạng cũ (.doc) không thể giải mã trực tiếp. Bạn vui lòng mở file và chọn Lưu dưới dạng (Save As) sang đuôi ".docx" hoặc chụp ảnh TKB để nhập nhé!');
    }
    throw new Error('Không thể mở tệp Word này. Hãy đảm bảo đây là file Word định dạng chuẩn (.docx).');
  }

  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Không tìm thấy nội dung văn bản (word/document.xml) trong file docx.');

  const xmlText = await docFile.async('text');
  const tables = extractDocxTables(xmlText);

  if (!tables.length) {
    const allTexts = (xmlText.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, ''))
      .join('\n');
    return parseTextTimetable(allTexts);
  }

  // Check if document contains multi-class tables (e.g. Master Timetable for all classes)
  const classMap = {}; // className -> { label, slots: [] }
  let hasMultiClassTable = false;

  for (const rows of tables) {
    if (!rows.length) continue;

    // Analyze header row (row 0)
    const headerCells = rows[0];

    // Detect class columns
    const classCols = {};
    headerCells.forEach((cellText, colIdx) => {
      const match = cellText.match(/(\d+[A-Za-z]+\d*)/);
      if (match) {
        const className = match[1];
        classCols[colIdx] = { className, fullLabel: cellText };
        if (!classMap[className]) {
          classMap[className] = { label: cellText, slots: [] };
        }
      }
    });

    if (Object.keys(classCols).length >= 2) {
      hasMultiClassTable = true;
      let currentDay = 1;
      let currentPeriod = 1;

      for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!cells.length) continue;

        // Day cell (col 0): Thứ 2..7 or empty
        if (cells[0]) {
          const dm = cells[0].match(/\d+/);
          if (dm) {
            const num = parseInt(dm[0], 10);
            currentDay = (num >= 2 && num <= 7) ? num - 1 : num;
          }
        }

        // Period cell (col 1): Tiết 1..5
        if (cells[1]) {
          const pm = cells[1].match(/\d+/);
          if (pm) currentPeriod = parseInt(pm[0], 10);
        }

        // Collect each class cell
        for (const [colStr, colInfo] of Object.entries(classCols)) {
          const colIdx = parseInt(colStr, 10);
          if (colIdx < cells.length) {
            const rawVal = cells[colIdx];
            const parsed = parseSubjectAndTeacher(rawVal);
            if (parsed) {
              const times = PERIOD_TIMES[currentPeriod] || {
                start: `${String(7 + Math.floor(currentPeriod / 2)).padStart(2, '0')}:00`,
                end: `${String(7 + Math.floor(currentPeriod / 2)).padStart(2, '0')}:45`
              };
              classMap[colInfo.className].slots.push({
                id: uid('imported'),
                day: currentDay,
                period: currentPeriod,
                title: parsed.title,
                subjectGroup: parsed.subjectGroup,
                start: times.start,
                end: times.end,
                type: 'school'
              });
            }
          }
        }
      }
    }
  }

  // If multi-class master timetable was detected:
  if (hasMultiClassTable && Object.keys(classMap).length > 1) {
    detectedMultiClasses = classMap;
    setupClassPickerUI(classMap);
    return [];
  }

  // Otherwise, fallback to single-table parser
  const rawSlots = [];
  for (const rows of tables) {
    if (!rows.length) continue;

    let dayCols = {};
    let periodCol = -1;

    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const cells = rows[r];
      for (let c = 0; c < cells.length; c++) {
        const text = cells[c].toLowerCase();
        if (text.includes('thứ 2') || text.includes('hai') || text === 't2' || text === '2') dayCols[c] = 1;
        else if (text.includes('thứ 3') || text.includes('ba') || text === 't3' || text === '3') dayCols[c] = 2;
        else if (text.includes('thứ 4') || text.includes('tư') || text === 't4' || text === '4') dayCols[c] = 3;
        else if (text.includes('thứ 5') || text.includes('năm') || text === 't5' || text === '5') dayCols[c] = 4;
        else if (text.includes('thứ 6') || text.includes('sáu') || text === 't6' || text === '6') dayCols[c] = 5;
        else if (text.includes('thứ 7') || text.includes('bảy') || text === 't7' || text === '7') dayCols[c] = 6;
        else if (text.includes('tiết')) periodCol = c;
      }
      if (Object.keys(dayCols).length >= 3) break;
    }

    if (Object.keys(dayCols).length < 2) {
      const cellCount = rows[0].length;
      if (cellCount >= 7) {
        dayCols = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
        periodCol = 0;
      } else if (cellCount === 6) {
        dayCols = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 };
      }
    }

    let currentPeriod = 1;
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.length) continue;

      if (periodCol >= 0 && cells[periodCol]) {
        const pMatch = cells[periodCol].match(/\d+/);
        if (pMatch) currentPeriod = parseInt(pMatch[0], 10);
      }

      for (const [colStr, dayNum] of Object.entries(dayCols)) {
        const colIdx = parseInt(colStr, 10);
        if (colIdx < cells.length && colIdx !== periodCol) {
          const rawCell = cells[colIdx];
          const parsed = parseSubjectAndTeacher(rawCell);
          if (parsed) {
            const times = PERIOD_TIMES[currentPeriod] || {
              start: `${String(7 + Math.floor(currentPeriod / 2)).padStart(2, '0')}:00`,
              end: `${String(7 + Math.floor(currentPeriod / 2)).padStart(2, '0')}:45`
            };
            rawSlots.push({
              id: uid('imported'),
              day: dayNum,
              period: currentPeriod,
              title: parsed.title,
              subjectGroup: parsed.subjectGroup,
              start: times.start,
              end: times.end,
              type: 'school'
            });
          }
        }
      }
      currentPeriod++;
    }
  }

  return mergeConsecutiveSlots(rawSlots);
}

function setupClassPickerUI(classMap) {
  const select = $('#importClassSelect');
  const classKeys = Object.keys(classMap);

  // Group classes by grade (Khối 12, Khối 11, Khối 10...)
  const groups = {};
  classKeys.forEach(cls => {
    const grade = cls.match(/^\d+/)?.[0] || 'Khác';
    if (!groups[grade]) groups[grade] = [];
    groups[grade].push(cls);
  });

  // Sort groups descending (12, 11, 10)
  const sortedGradeKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  let optionsHTML = '';
  sortedGradeKeys.forEach(gradeKey => {
    const label = gradeKey === 'Khác' ? 'Lớp khác' : `Khối ${gradeKey}`;
    optionsHTML += `<optgroup label="${label}">`;
    groups[gradeKey].forEach(cls => {
      optionsHTML += `<option value="${cls}">${escapeHTML(classMap[cls].label)}</option>`;
    });
    optionsHTML += `</optgroup>`;
  });

  select.innerHTML = optionsHTML;

  // Auto-select based on user profile (e.g. currentUser.profile.grade = "Lớp 12A1")
  const userGradeText = (currentUser.profile?.grade || '').toUpperCase();
  const matchedClass = classKeys.find(cls => userGradeText.includes(cls));
  const initialClass = matchedClass || classKeys[0];

  select.value = initialClass;
  selectedImportClassName = initialClass;
  parsedImportSlots = mergeConsecutiveSlots(classMap[initialClass].slots);

  $('#parsedClassLabel').textContent = `lớp ${classMap[initialClass].label}`;
  $('#classPickerBox').hidden = false;
  renderImportPreview();
}

async function parseImageTimetable(file) {
  try {
    if (!file || !file.type.startsWith('image/')) throw new Error('Vui lòng chọn tệp hình ảnh PNG, JPG hoặc WebP.');
    const buffer = await file.arrayBuffer();
    const image = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < image.length; offset += chunkSize) {
      binary += String.fromCharCode(...image.subarray(offset, offset + chunkSize));
    }
    const response = await fetch('/api/parse-timetable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: btoa(binary), mimeType: file.type })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Không đọc được ảnh này.');
    if (!Array.isArray(result.slots)) throw new Error('AI không trả về thời khóa biểu hợp lệ.');
    return result.slots.map(slot => ({ ...slot, id: uid('img-slot'), type: 'school' }));
  } catch (error) {
    if (error.message?.startsWith('Không đọc được') || error.message?.startsWith('Vui lòng')) throw error;
    throw new Error('Không đọc được ảnh này, thử ảnh rõ nét hơn hoặc nhập tay.');
  }
}

function parseTextTimetable(text) {
  const lines = text.split(/\r?\n/);
  const slots = [];
  let currentDay = 1;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    const lower = l.toLowerCase();
    if (lower.includes('thứ 2') || lower.startsWith('t2')) currentDay = 1;
    else if (lower.includes('thứ 3') || lower.startsWith('t3')) currentDay = 2;
    else if (lower.includes('thứ 4') || lower.startsWith('t4')) currentDay = 3;
    else if (lower.includes('thứ 5') || lower.startsWith('t5')) currentDay = 4;
    else if (lower.includes('thứ 6') || lower.startsWith('t6')) currentDay = 5;
    else if (lower.includes('thứ 7') || lower.startsWith('t7')) currentDay = 6;
    else {
      const parts = l.split(/[:,;-]/).map(p => parseSubjectAndTeacher(p)).filter(Boolean);
      parts.forEach((pObj, idx) => {
        const period = Math.min(10, idx + 1);
        const times = PERIOD_TIMES[period] || { start: '07:15', end: '08:00' };
        slots.push({
          id: uid('txt-slot'),
          day: currentDay,
          period,
          title: pObj.title,
          subjectGroup: pObj.subjectGroup,
          start: times.start,
          end: times.end,
          type: 'school'
        });
      });
    }
  }

  return mergeConsecutiveSlots(slots);
}

function renderImportPreview() {
  $('#parsedSlotCount').textContent = parsedImportSlots.length;
  const listEl = $('#previewSlotList');
  if (!parsedImportSlots.length) {
    listEl.innerHTML = `<div class="empty-state" style="padding:18px;">Không tìm thấy ca học nào trong tệp. Hãy thử tải tệp Word (.docx) hoặc ảnh TKB rõ nét hơn.</div>`;
    $('#applyTimetableBtn').disabled = true;
  } else {
    listEl.innerHTML = parsedImportSlots.map((slot, idx) => `
      <div class="preview-slot-item">
        <span class="preview-slot-day">${dayNames[slot.day] || 'T' + (slot.day+1)}</span>
        <span class="preview-slot-time">${slot.start}–${slot.end}</span>
        <span class="preview-slot-name">${escapeHTML(slot.title)} <small style="color:#888;font-weight:normal;">${slot.periodLabel ? '(' + escapeHTML(slot.periodLabel) + ')' : ''}</small></span>
        <button type="button" class="preview-slot-del" data-delete-import-slot="${idx}" aria-label="Xóa ca">×</button>
      </div>
    `).join('');
    $('#applyTimetableBtn').disabled = false;
  }

  $('#importStatus').hidden = true;
  $('#importPreview').hidden = false;
}

function applyImportedTimetable() {
  if (!parsedImportSlots.length) return;
  const mode = $('input[name="importMode"]:checked')?.value || 'replace';

  if (mode === 'replace') {
    currentUser.fixedSchedules = currentUser.fixedSchedules.filter(item => item.type !== 'school');
  }

  if (selectedImportClassName) {
    currentUser.profile.grade = `Lớp ${selectedImportClassName}`;
  }

  parsedImportSlots.forEach(slot => {
    currentUser.fixedSchedules.push({
      id: uid('fixed-school'),
      title: slot.title + (slot.periodLabel ? ` (${slot.periodLabel})` : ''),
      day: slot.day,
      start: slot.start,
      end: slot.end,
      type: 'school',
      flexible: false
    });

    const targetName = slot.subjectGroup || slot.title;
    const existing = currentUser.subjects.find(s => s.name.toLowerCase() === targetName.toLowerCase());
    if (!existing && !['Chào cờ', 'Sinh hoạt lớp', 'Thể dục / GDQP', 'Sinh hoạt', 'Hoạt động trải nghiệm'].includes(targetName)) {
      const meta = SUBJECT_METADATA[targetName] || { color: 'custom', icon: targetName.slice(0, 1).toUpperCase() };
      currentUser.subjects.push({
        id: uid('subject'),
        name: targetName,
        target: 'Môn học theo TKB',
        color: meta.color,
        icon: meta.icon,
        topics: meta.defaultTopic ? [{ id: uid('topic'), name: meta.defaultTopic, mastery: 50, quiz: {} }] : []
      });
    }
  });

  persist();
  renderApp();
  closeModal('importTimetableModal');
  const classMsg = selectedImportClassName ? `lớp ${selectedImportClassName} ` : '';
  toast(`Đã cập nhật thành công TKB ${classMsg}(${parsedImportSlots.length} ca học)!`);
  showPage('schedule');
}

function renderApp() {
  if (!currentUser) return;
  currentUser.studyNotes = currentUser.studyNotes || [];
  currentUser.examMilestones = currentUser.examMilestones || [
    { id: 'm-midterm1', title: 'Thi Giữa Học Kỳ I', date: relDate(35), subjects: 'Toán, Vật lí, Hóa học, Ngữ văn, Tiếng Anh' },
    { id: 'm-final1', title: 'Thi Cuối Học Kỳ I', date: relDate(95), subjects: 'Toán, Vật lí, Hóa học, Tiếng Anh, Sinh học' },
    { id: 'm-thpt', title: 'Kỳ thi Tốt nghiệp THPT 2026', date: '2026-06-26', subjects: 'Toán, Ngữ văn, Tiếng Anh, Vật lí' },
  ];
  renderHeader();
  renderCalendar();
  renderExamCountdown();
  renderToday();
  renderInbox();
  renderTakeNotes();
  renderSubjectProgress();
  renderSchedule();
  renderSubjects();
  renderProgress();
  renderTasks();
  renderInsights();
  renderSettings();
  updateNotificationBadge();
  if (notificationScheduler && currentUser?.settings?.reminders !== false) {
    try { notificationScheduler.reconcile(currentUser); } catch (e) { console.warn('Scheduler reconcile error:', e); }
  }
}

function showPage(page) { activePage = page; $$('.page').forEach(item => item.classList.toggle('active-page', item.id === page)); $$('.nav-link').forEach(item => item.classList.toggle('active', item.dataset.page === page)); renderHeader(); if (window.innerWidth <= 600) $('.sidebar').classList.remove('mobile-open'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function openModal(id) { const modal = $(`#${id}`); if (!modal) return; modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { const modal = $(`#${id}`); if (!modal) return; modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); if (id === 'quickLogModal' && pendingTimerCompletion) { pendingTimerCompletion = null; $('#logTopic').disabled = false; $('#logMinutes').disabled = false; $('#quickLogTitle').textContent = 'Bạn vừa học thế nào?'; } if (!$$('.modal-backdrop.open').length) document.body.style.overflow = ''; }
function toast(message, type = 'info') {
  if (notificationService) {
    if (type === 'danger' || type === 'error') {
      return notificationService.error(message);
    }
    if (type === 'success') {
      return notificationService.success(message);
    }
    if (type === 'warning') {
      return notificationService.warning(message);
    }
    return notificationService.notify(message);
  }
  const element = $('#toast');
  if (element) {
    element.style.display = 'block';
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(element.timer);
    element.timer = setTimeout(() => {
      element.classList.remove('show');
      element.style.display = 'none';
    }, 3000);
  }
}

// ── Quick Capture & Inbox Architecture (PRODUCT UX PHASE 1) ────────────────
let quickCaptureChosenDest = 'inbox';
let currentParsedCapture = null;

function openQuickCaptureModal() {
  const input = $('#quickCaptureInput');
  if (input) input.value = '';
  quickCaptureChosenDest = 'inbox';
  syncQcChips('inbox');
  updateQuickCapturePreview();
  openModal('quickCaptureModal');
  setTimeout(() => {
    if (input) input.focus();
  }, 50);
}

function syncQcChips(dest) {
  quickCaptureChosenDest = dest;
  $$('.qc-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.dest === dest);
  });
}

function updateQuickCapturePreview() {
  const input = $('#quickCaptureInput');
  const text = input ? input.value : '';
  const parsed = QuickCaptureUtil ? QuickCaptureUtil.parseCaptureInput(text, TODAY) : {
    cleanTitle: text.trim(),
    durationMinutes: 30,
    targetDate: null,
    priority: 3,
    destination: 'Inbox'
  };
  currentParsedCapture = parsed;

  const titleEl = $('#qcParsedTitle');
  if (titleEl) {
    titleEl.textContent = parsed.cleanTitle || 'Nhập tiêu đề ở trên...';
  }

  const durationEl = $('#qcParsedDuration');
  if (durationEl) {
    durationEl.textContent = `⏱ ${parsed.durationMinutes} phút`;
  }

  const priorityEl = $('#qcPriorityBadge');
  if (priorityEl) {
    const isHigh = parsed.priority >= 4;
    priorityEl.className = `qc-badge ${isHigh ? 'priority-high' : 'priority-normal'}`;
    priorityEl.textContent = isHigh ? 'Ưu tiên cao (!)' : 'Ưu tiên thường';
  }

  const destToUse = quickCaptureChosenDest;
  const dateEl = $('#qcParsedDate');
  if (dateEl) {
    if (destToUse === 'today') {
      dateEl.textContent = `📅 Lên lịch: Hôm nay (${formatShortDate(TODAY)})`;
    } else if (destToUse === 'tomorrow') {
      const tomorrow = DateUtil ? DateUtil.addAppDays(TODAY, 1) : TODAY;
      dateEl.textContent = `📅 Lên lịch: Ngày mai (${formatShortDate(tomorrow)})`;
    } else if (destToUse === 'inbox') {
      dateEl.textContent = '📥 Lưu vào Hộp thư (Inbox)';
    } else if (parsed.targetDate) {
      dateEl.textContent = `📅 Lên lịch: ${formatShortDate(parsed.targetDate)}`;
    } else {
      dateEl.textContent = '📥 Lưu vào Hộp thư (Inbox)';
    }
  }
}

function submitQuickCapture() {
  if (!currentParsedCapture || !currentParsedCapture.cleanTitle) {
    toast('Vui lòng nhập tên công việc.', 'warning');
    return;
  }
  const dest = quickCaptureChosenDest;
  let scheduledDate = null;
  let isInbox = false;

  if (dest === 'today') {
    scheduledDate = TODAY;
    isInbox = false;
  } else if (dest === 'tomorrow') {
    scheduledDate = DateUtil ? DateUtil.addAppDays(TODAY, 1) : TODAY;
    isInbox = false;
  } else if (dest === 'inbox') {
    scheduledDate = null;
    isInbox = true;
  } else if (currentParsedCapture.targetDate) {
    scheduledDate = currentParsedCapture.targetDate;
    isInbox = false;
  } else {
    isInbox = true;
  }

  const newTask = {
    id: 'task-' + Date.now(),
    subjectId: currentUser.subjects[0]?.id || 'math',
    title: currentParsedCapture.cleanTitle,
    minutes: currentParsedCapture.durationMinutes || 30,
    priority: currentParsedCapture.priority || 3,
    status: 'open',
    isInbox: isInbox,
    scheduledDate: scheduledDate,
    deadline: scheduledDate,
    createdAt: TODAY
  };

  currentUser.tasks = currentUser.tasks || [];
  currentUser.tasks.push(newTask);
  persist();
  closeModal('quickCaptureModal');
  renderApp();
  toast(`Đã thêm: "${newTask.title}" (${isInbox ? 'Hộp thư Inbox' : 'Lịch ' + formatShortDate(scheduledDate)})`, 'success');
}

let proposedInboxPlan = [];

function openPlanInboxModal() {
  const items = InboxServiceUtil ? InboxServiceUtil.getInboxItems(currentUser.tasks) : [];
  const openItems = items.filter(t => t.status !== 'done');
  if (!openItems.length) {
    toast('Hộp thư đang trống, không có công việc nào cần xếp lịch.', 'info');
    return;
  }

  const planToday = createPlan(TODAY);
  const freeToday = TodayEngineUtil
    ? TodayEngineUtil.calculateFreeTime(currentUser.availability, planToday.fixed, planToday.plan, DateUtil ? DateUtil.getNowVietnam() : new Date())
    : 60;

  const tomorrow = DateUtil ? DateUtil.addAppDays(TODAY, 1) : TODAY;

  const sorted = [...openItems].sort((a, b) => (b.priority || 3) - (a.priority || 3));
  proposedInboxPlan = [];
  let curTodayCap = freeToday;

  for (const item of sorted) {
    const dur = Number(item.minutes) || 30;
    if (curTodayCap >= dur) {
      proposedInboxPlan.push({ item, targetDate: TODAY, dateLabel: 'Hôm nay' });
      curTodayCap -= dur;
    } else {
      proposedInboxPlan.push({ item, targetDate: tomorrow, dateLabel: 'Ngày mai' });
    }
  }

  const listEl = $('#planInboxPreviewList');
  if (listEl) {
    listEl.innerHTML = proposedInboxPlan.map(p => `
      <div class="plan-preview-item">
        <div>
          <strong>${escapeHTML(p.item.title)}</strong>
          <small style="display:block;color:#7e7a72;font-family:'DM Mono';">⏱ ${p.item.minutes || 30}p · ${p.item.priority >= 4 ? 'Ưu tiên cao' : 'Bình thường'}</small>
        </div>
        <span class="plan-preview-slot">➜ ${p.dateLabel} (${formatShortDate(p.targetDate)})</span>
      </div>
    `).join('');
  }

  openModal('planInboxModal');
}

function applyProposedInboxPlan() {
  if (!proposedInboxPlan.length) return;
  for (const p of proposedInboxPlan) {
    if (InboxServiceUtil) {
      InboxServiceUtil.scheduleItem(p.item, p.targetDate);
    } else {
      p.item.scheduledDate = p.targetDate;
      p.item.deadline = p.targetDate;
      p.item.isInbox = false;
    }
  }
  persist();
  closeModal('planInboxModal');
  renderApp();
  toast(`Đã xếp lịch cho ${proposedInboxPlan.length} việc từ Hộp thư!`, 'success');
  showPage('schedule');
}

/* ─────────────────────────────────────────────────────────────
   P1.1 AI TIME MANAGEMENT FOUNDATION (ASK CALENDAR & REVIEW)
   ───────────────────────────────────────────────────────────── */

// ─── P1.2 — AI Planner State ─────────────────────────────────────────────────
let currentAiProposal = null;
let currentAiIntent = null;
let _currentAiContext = null; // context snapshot used when proposal was generated

/**
 * Compute a deterministic fingerprint of the current user's calendar state.
 * Used for stale-proposal detection.
 * @returns {string} 8-char hex fingerprint
 */
function getCurrentCalendarRevision() {
  if (typeof PlannerContext !== 'undefined' && PlannerContext.computeCalendarRevision) {
    return PlannerContext.computeCalendarRevision(currentUser);
  }
  // Fallback: simple JSON hash of tasks + fixedSchedules length
  if (!currentUser) return '00000000';
  const key = (currentUser.tasks || []).length + ':' + (currentUser.fixedSchedules || []).length;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Renders the Plan Quality Score Meter in the review modal.
 * @param {Object} quality - { score, strengths, warnings, metrics }
 */
function renderQualityMeter(quality) {
  const meter = $('#aiQualityMeter');
  if (!meter || !quality) return;

  meter.hidden = false;
  const scorePill = $('#aiQualityScorePill');
  const barFill = $('#aiQualityBarFill');
  const strengthsList = $('#aiQualityStrengths');
  const warnsList = $('#aiQualityWarningsList');

  const score = quality.score || 0;
  if (scorePill) {
    scorePill.textContent = score + ' / 100';
    scorePill.className = 'ai-quality-score-pill' + (
      score >= 80 ? ' score-high' : score >= 55 ? ' score-mid' : ' score-low'
    );
  }
  if (barFill) barFill.style.width = score + '%';
  if (strengthsList) {
    strengthsList.innerHTML = (quality.strengths || [])
      .map(s => `<li>${escapeHTML(s)}</li>`).join('');
  }
  if (warnsList) {
    warnsList.innerHTML = (quality.warnings || [])
      .map(w => `<li>${escapeHTML(w)}</li>`).join('');
  }
}

/**
 * Renders interactive action cards into #aiProposedActionsList.
 * Each card has: title, type badge, time display, date input, time input, remove button.
 * @param {Array} actions
 */
function renderActionCards(actions) {
  const actionsListEl = $('#aiProposedActionsList');
  if (!actionsListEl) return;

  actionsListEl.innerHTML = (actions || []).map((act, idx) => {
    const isEvent = act.type === 'create_event';
    const typeLabel = isEvent ? 'Lịch cố định' : 'Nhiệm vụ học';
    const typeClass = isEvent ? 'type-event' : '';
    const slotText = (act.startTime && act.endTime) ? `${act.startTime} – ${act.endTime}` : `${act.durationMinutes || 45}p`;

    return `
      <div class="ai-action-card" data-action-idx="${idx}">
        <div class="ai-action-card-header">
          <span class="ai-action-card-title">${escapeHTML(act.title)}</span>
          <span class="ai-action-card-time">${slotText}</span>
          <span class="ai-action-card-type ${typeClass}">${typeLabel}</span>
        </div>
        <div class="ai-action-edit-row">
          <span class="ai-action-edit-label">Ngày:</span>
          <input type="date" class="ai-action-date-input" data-action-idx="${idx}" value="${escapeHTML(act.date || '')}" />
          <span class="ai-action-edit-label">Giờ bắt đầu:</span>
          <input type="time" class="ai-action-time-input" data-action-idx="${idx}" value="${escapeHTML(act.startTime || '')}" />
          <button type="button" class="ai-action-remove-btn" data-action-idx="${idx}" aria-label="Xóa hành động này">✕</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach delegated change listeners for live quality recalculation
  actionsListEl.addEventListener('change', handleActionCardEdit);
  actionsListEl.addEventListener('click', handleActionCardRemove);
}

/**
 * Handles date/time edits on action cards — updates the proposal in-memory
 * and live-recalculates quality score.
 */
function handleActionCardEdit(e) {
  if (!currentAiProposal || !Array.isArray(currentAiProposal.actions)) return;
  const input = e.target;
  const idx = parseInt(input.dataset.actionIdx, 10);
  if (isNaN(idx) || idx < 0 || idx >= currentAiProposal.actions.length) return;

  const action = currentAiProposal.actions[idx];
  if (input.classList.contains('ai-action-date-input')) {
    action.date = input.value;
  } else if (input.classList.contains('ai-action-time-input')) {
    action.startTime = input.value;
    // Recompute endTime from startTime + durationMinutes
    if (action.durationMinutes > 0 && typeof AppDate !== 'undefined' && AppDate.minFromTime && AppDate.timeFromMin) {
      action.endTime = AppDate.timeFromMin(AppDate.minFromTime(input.value) + action.durationMinutes);
    }
  }

  // Live re-validate and re-evaluate quality
  liveRevalidateProposal();
}

/**
 * Handles remove button clicks on action cards.
 */
function handleActionCardRemove(e) {
  if (!currentAiProposal || !Array.isArray(currentAiProposal.actions)) return;
  const btn = e.target.closest('.ai-action-remove-btn');
  if (!btn) return;

  const idx = parseInt(btn.dataset.actionIdx, 10);
  if (isNaN(idx)) return;

  currentAiProposal.actions.splice(idx, 1);
  renderActionCards(currentAiProposal.actions);
  liveRevalidateProposal();
}

/**
 * Live re-validates the current proposal and refreshes the quality score.
 */
function liveRevalidateProposal() {
  if (!currentAiProposal || !_currentAiContext) return;

  // Re-validate
  const validation = (typeof PlanningProposal !== 'undefined' && PlanningProposal.validatePlanningProposal)
    ? PlanningProposal.validatePlanningProposal(currentAiProposal, _currentAiContext)
    : { valid: true, warnings: [] };

  // Re-evaluate quality
  const quality = (typeof PlanEvaluator !== 'undefined' && PlanEvaluator.evaluatePlanQuality)
    ? PlanEvaluator.evaluatePlanQuality(currentAiProposal, _currentAiContext)
    : null;

  renderQualityMeter(quality);

  const warningsBox = $('#aiWarningsBox');
  const warningsList = $('#aiWarningsList');
  const allWarnings = [
    ...(Array.isArray(currentAiProposal.warnings) ? currentAiProposal.warnings : []),
    ...(Array.isArray(validation.warnings) ? validation.warnings : [])
  ];
  if (warningsBox && warningsList) {
    if (allWarnings.length > 0) {
      warningsBox.hidden = false;
      warningsList.innerHTML = allWarnings.map(w =>
        `<li>${escapeHTML(typeof w === 'string' ? w : (w.message || JSON.stringify(w)))}</li>`
      ).join('');
    } else {
      warningsBox.hidden = true;
    }
  }
}

async function handleAiAskSubmit() {
  const inputEl = $('#aiAskInput');
  const text = (inputEl ? inputEl.value : '').trim();
  if (!text) {
    toast('Vui lòng nhập yêu cầu của bạn, ví dụ: "Ngày mai học Lý 2 tiếng, làm Anh 1 tiếng, tối 7h đá bóng..."', 'info');
    return;
  }

  const btn = $('#aiAskBtn');
  const statusPill = $('#aiStatusPill');
  if (btn) btn.disabled = true;
  if (statusPill) {
    statusPill.textContent = 'Đang phân tích...';
    statusPill.style.color = '#c8892c';
  }

  try {
    // Build context with calendar revision for stale protection
    const context = (typeof PlannerContext !== 'undefined' && PlannerContext.buildPlanningContext)
      ? PlannerContext.buildPlanningContext(currentUser, TODAY, { horizonDays: 3 })
      : { currentDate: TODAY, availability: currentUser?.availability || { start: '15:00', end: '21:30' } };

    _currentAiContext = context; // snapshot for live revalidation

    const aiClient = (typeof ClientAIAdapterUtil !== 'undefined' && ClientAIAdapterUtil)
      ? new ClientAIAdapterUtil()
      : null;

    let intentRes = null;
    let planRes = null;

    if (aiClient) {
      intentRes = await aiClient.parseIntent(text, context);
      planRes = await aiClient.generatePlan(text, context);
    } else {
      const fallback = (typeof DeterministicFallbackProvider !== 'undefined')
        ? new DeterministicFallbackProvider()
        : null;
      if (fallback) {
        intentRes = await fallback.parseIntent(text, context);
        planRes = await fallback.generatePlan(text, context);
      }
    }

    const intent = (intentRes && intentRes.intent) ? intentRes.intent : null;
    let proposal = (planRes && planRes.proposal) ? planRes.proposal : null;

    if (!proposal || !Array.isArray(proposal.actions) || proposal.actions.length === 0) {
      toast('Không tìm thấy hành động lịch trình phù hợp trong câu yêu cầu. Hãy thử miêu tả rõ hơn thời gian hoặc môn học.', 'warning');
      return;
    }

    // Embed calendar revision into proposal for stale detection
    proposal.contextVersion = getCurrentCalendarRevision();

    // Validate
    const validation = (typeof PlanningProposal !== 'undefined' && PlanningProposal.validatePlanningProposal)
      ? PlanningProposal.validatePlanningProposal(proposal, context)
      : { valid: true, warnings: [] };

    // Evaluate quality
    const quality = (typeof PlanEvaluator !== 'undefined' && PlanEvaluator.evaluatePlanQuality)
      ? PlanEvaluator.evaluatePlanQuality(proposal, context)
      : null;

    if (quality) proposal.quality = quality;

    currentAiProposal = proposal;
    currentAiIntent = intent;

    // Reset stale banner
    const staleBanner = $('#aiStaleWarningBanner');
    if (staleBanner) staleBanner.hidden = true;

    // Populate source tag & confidence
    const sourceTag = $('#aiReviewSourceTag');
    if (sourceTag) {
      sourceTag.textContent = proposal.source === 'ai' ? '✦ AI PLANNING (GEMINI)' : '✦ SMART ENGINE (DỰ PHÒNG)';
    }
    const confBadge = $('#aiConfidenceBadge');
    if (confBadge) {
      const pct = Math.round((proposal.confidence || 0.9) * 100);
      confBadge.textContent = `Độ tin cậy: ${pct}%`;
    }

    // Render quality meter
    renderQualityMeter(quality);

    // Render intent chips
    const fixedContainer = $('#aiFixedChipsList');
    const taskContainer = $('#aiTaskChipsList');
    const fixedGroup = $('#aiFixedChips');
    const taskGroup = $('#aiTaskChips');

    if (fixedContainer && taskContainer) {
      const fixedItems = (intent && Array.isArray(intent.fixedEvents)) ? intent.fixedEvents : [];
      const taskItems = (intent && Array.isArray(intent.tasks)) ? intent.tasks : [];

      if (fixedItems.length > 0) {
        if (fixedGroup) fixedGroup.hidden = false;
        fixedContainer.innerHTML = fixedItems.map(f => `
          <span class="ai-pill-chip fixed-chip">
            📌 ${escapeHTML(f.title)} (${f.start} - ${f.end})
          </span>
        `).join('');
      } else if (fixedGroup) {
        fixedGroup.hidden = true;
      }

      if (taskItems.length > 0) {
        if (taskGroup) taskGroup.hidden = false;
        taskContainer.innerHTML = taskItems.map(t => `
          <span class="ai-pill-chip task-chip">
            ⏱ ${escapeHTML(t.title)} (${t.durationMinutes}p)
          </span>
        `).join('');
      } else if (taskGroup) {
        taskGroup.hidden = true;
      }
    }

    // Render interactive action cards (P1.2: with edit controls)
    renderActionCards(proposal.actions);

    // Render rationales
    const rationaleListEl = $('#aiRationaleList');
    if (rationaleListEl) {
      const reasons = Array.isArray(proposal.rationale) ? proposal.rationale : [];
      if (reasons.length > 0) {
        rationaleListEl.innerHTML = reasons.map(r =>
          `<li>${escapeHTML(typeof r === 'string' ? r : (r.reason || ''))}</li>`
        ).join('');
      } else {
        rationaleListEl.innerHTML = '<li>Đã cân đối dựa trên thời gian rảnh và thứ tự ưu tiên của bạn.</li>';
      }
    }

    // Render warnings
    const warningsBox = $('#aiWarningsBox');
    const warningsList = $('#aiWarningsList');
    const allWarnings = [
      ...(Array.isArray(proposal.warnings) ? proposal.warnings : []),
      ...(Array.isArray(validation.warnings) ? validation.warnings : [])
    ];
    if (warningsBox && warningsList) {
      if (allWarnings.length > 0) {
        warningsBox.hidden = false;
        warningsList.innerHTML = allWarnings.map(w =>
          `<li>${escapeHTML(typeof w === 'string' ? w : (w.message || JSON.stringify(w)))}</li>`
        ).join('');
      } else {
        warningsBox.hidden = true;
      }
    }

    openModal('aiPlanReviewModal');
  } catch (err) {
    console.error('AI Ask error:', err);
    toast('Có lỗi xảy ra khi xử lý yêu cầu AI. Vui lòng thử lại.', 'danger');
  } finally {
    if (btn) btn.disabled = false;
    if (statusPill) {
      statusPill.textContent = 'Sẵn sàng';
      statusPill.style.color = '';
    }
  }
}

function applyProposedAiPlan() {
  if (!currentAiProposal || !Array.isArray(currentAiProposal.actions) || !currentAiProposal.actions.length) {
    toast('Không có đề xuất nào để áp dụng.', 'info');
    return;
  }

  // ── Stale Proposal Protection ──────────────────────────────────────────────
  const proposalRevision = currentAiProposal.contextVersion;
  const currentRevision = getCurrentCalendarRevision();

  if (proposalRevision && proposalRevision !== currentRevision) {
    const staleBanner = $('#aiStaleWarningBanner');
    if (staleBanner) staleBanner.hidden = false;
    toast('⚠️ Lịch của bạn đã thay đổi. Kế hoạch này đã lỗi thời và cần được tính lại.', 'warning');
    return;
  }

  // ── Fresh Re-Validation Before Applying ───────────────────────────────────
  const freshContext = (typeof PlannerContext !== 'undefined' && PlannerContext.buildPlanningContext)
    ? PlannerContext.buildPlanningContext(currentUser, TODAY)
    : _currentAiContext || { currentDate: TODAY };

  const validation = (typeof PlanningProposal !== 'undefined' && PlanningProposal.validatePlanningProposal)
    ? PlanningProposal.validatePlanningProposal(currentAiProposal, freshContext)
    : { valid: true, errors: [] };

  if (!validation.valid) {
    toast('⚠️ Kế hoạch có xung đột thời gian. Vui lòng chỉnh sửa lại trước khi áp dụng.', 'warning');
    liveRevalidateProposal();
    return;
  }

  // ── Apply Actions ──────────────────────────────────────────────────────────
  let eventCount = 0;
  let taskCount = 0;

  for (const act of currentAiProposal.actions) {
    if (act.type === 'create_event') {
      currentUser.fixedSchedules = currentUser.fixedSchedules || [];
      const actDate = act.date || TODAY;
      const weekday = (typeof AppDate !== 'undefined' && AppDate.getWeekday) ? AppDate.getWeekday(actDate) : 1;
      currentUser.fixedSchedules.push({
        id: 'event-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        title: act.title,
        day: weekday,
        start: act.startTime || '19:00',
        end: act.endTime || '20:00',
        date: actDate,
        type: 'activity',
        fixed: true
      });
      eventCount++;
    } else if (act.type === 'schedule_task') {
      currentUser.tasks = currentUser.tasks || [];
      currentUser.tasks.push({
        id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        subjectId: currentUser.subjects?.[0]?.id || 'general',
        title: act.title,
        minutes: act.durationMinutes || 45,
        priority: 3,
        status: 'open',
        isInbox: false,
        scheduledDate: act.date || TODAY,
        deadline: act.date || TODAY,
        startTime: act.startTime,
        endTime: act.endTime,
        createdAt: TODAY
      });
      taskCount++;
    } else if (act.type === 'move_task') {
      const existing = (currentUser.tasks || []).find(t => t.id === act.taskId);
      if (existing) {
        existing.scheduledDate = act.targetDate || TODAY;
        existing.deadline = act.targetDate || TODAY;
        existing.isInbox = false;
        taskCount++;
      }
    }
  }

  persist();
  closeModal('aiPlanReviewModal');
  renderApp();

  const inputEl = $('#aiAskInput');
  if (inputEl) inputEl.value = '';

  // ── Notification Engine Integration ───────────────────────────────────────
  const summary = [];
  if (eventCount > 0) summary.push(`${eventCount} sự kiện cố định`);
  if (taskCount > 0) summary.push(`${taskCount} việc học`);
  const successMsg = `Đã áp dụng thành công ${summary.join(' và ')} vào lịch!`;

  if (typeof notificationService !== 'undefined' && notificationService.notify) {
    notificationService.notify({
      title: '✦ Kế hoạch AI đã áp dụng',
      message: successMsg,
      type: 'SYSTEM_FEEDBACK',
      severity: 'success'
    });
  } else {
    toast(successMsg, 'success');
  }

  currentAiProposal = null;
  currentAiIntent = null;
  _currentAiContext = null;

  showPage('schedule');
}

function openStudy(taskId) { const task = getTask(taskId) || openTasks()[0]; if (!task) { toast('Hãy thêm một nhiệm vụ trước khi bắt đầu phiên học.'); showPage('tasks'); return; } selectedTimerTask = task; timerTotal = Number(task.minutes) * 60; timerSeconds = timerTotal; const subject = getSubject(task.subjectId); const style = appearance(subject); $('#timerOrb').className = `subject-orb ${style.orb} large`; $('#timerOrb').innerHTML = style.icon; $('#timerMeta').textContent = `${subject?.name || 'Tự học'} · ${task.minutes} PHÚT`; $('#studyTitle').textContent = task.title; $('#timerNote').textContent = 'Khi hoàn thành, TB sẽ lưu phiên học và tạo mốc ôn lại dựa trên mức độ hiểu của bạn.'; updateTimer(); $('#pauseTimer').textContent = 'Tạm dừng'; openModal('studyModal'); if (!timerRunning) toggleTimer(); }
function updateTimer() { $('#timerDisplay').textContent = `${String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:${String(timerSeconds % 60).padStart(2, '0')}`; $('#timerProgress').style.width = `${Math.min(100, ((timerTotal - timerSeconds) / timerTotal) * 100)}%`; }
function toggleTimer() { timerRunning = !timerRunning; $('#pauseTimer').textContent = timerRunning ? 'Tạm dừng' : 'Tiếp tục'; if (timerRunning) { timerInterval = setInterval(() => { if (timerSeconds > 0) { timerSeconds -= 1; updateTimer(); } else { toggleTimer(); toast('Đã hết thời gian cho phiên này.'); } }, 1000); } else clearInterval(timerInterval); }
function saveSession({ topicId, minutes, understanding, taskId = null }) {
  currentUser.sessions.push({ id: uid('session'), topicId, minutes: Number(minutes), understanding: Number(understanding), status: 'complete', date: TODAY, taskId });
  const entry = getTopic(topicId);
  if (entry) {
    const masteryDelta = Math.max(2, Number(understanding) * 6);
    entry.mastery = Math.min(100, Math.max(0, Math.round(entry.mastery + masteryDelta / 2)));
    scheduleReviewForTopic(topicId, understanding);
  }
  persist();
  renderApp();
}
function completeTimer() {
  if (!selectedTimerTask) return;
  if (timerRunning) toggleTimer();
  pendingTimerCompletion = { taskId: selectedTimerTask.id, topicId: selectedTimerTask.topicId, minutes: selectedTimerTask.minutes };
  closeModal('studyModal');
  openQuickLog();
  $('#logTopic').value = selectedTimerTask.topicId;
  $('#logMinutes').value = String(selectedTimerTask.minutes);
  $('#logTopic').disabled = true;
  $('#logMinutes').disabled = true;
  $('#quickLogTitle').textContent = 'Bạn hiểu bài mức nào?';
  $('#quickLogForm button[type="submit"]').textContent = 'Lưu phiên học';
}

function completeReview(reviewId) {
  const review = (currentUser.reviewSchedules || []).find(item => item.id === reviewId);
  if (!review) return;
  review.status = 'done';
  const note = (currentUser.studyNotes || []).find(item => item.id === review.noteId);
  if (note) note.reviewed = true;
  persist();
  renderApp();
  toast('Đã đánh dấu hoàn thành lần ôn.');
}
function toggleTask(taskId) { const task = getTask(taskId); if (!task) return; task.status = task.status === 'done' ? 'open' : 'done'; persist(); renderApp(); toast(task.status === 'done' ? 'Đã cập nhật nhiệm vụ hoàn thành.' : 'Nhiệm vụ đã được mở lại.'); }

function populateTaskFields(subjectId, topicId) { const select = $('#taskSubject'); select.innerHTML = currentUser.subjects.map(subject => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join(''); if (subjectId) select.value = subjectId; const subject = getSubject(select.value); $('#taskTopic').innerHTML = subject?.topics.length ? subject.topics.map(topic => `<option value="${topic.id}">${escapeHTML(topic.name)}</option>`).join('') : '<option value="">Chưa có chủ đề</option>'; if (topicId) $('#taskTopic').value = topicId; }
function openTaskModal(task = null) { if (!currentUser.subjects.length) { toast('Hãy thêm ít nhất một môn học trước khi tạo nhiệm vụ.'); showPage('subjects'); return; } $('#taskModalTitle').textContent = task ? 'Chỉnh sửa nhiệm vụ' : 'Thêm nhiệm vụ mới'; $('#taskId').value = task?.id || ''; $('#taskName').value = task?.title || ''; populateTaskFields(task?.subjectId, task?.topicId); $('#taskDuration').value = String(task?.minutes || 45); $('#taskPriority').value = String(task?.priority || 4); $('#taskDeadline').value = task?.deadline || TODAY; $('#deleteTaskButton').hidden = !task; openModal('taskModal'); }
function saveTask(event) { event.preventDefault(); const id = $('#taskId').value; const title = $('#taskName').value.trim(); const subjectId = $('#taskSubject').value; const topicId = $('#taskTopic').value; if (!title || !subjectId || !topicId) { toast('Hãy chọn môn học và chủ đề cho nhiệm vụ.'); return; } const task = { id: id || uid('task'), subjectId, topicId, title, minutes: Number($('#taskDuration').value), priority: Number($('#taskPriority').value), deadline: $('#taskDeadline').value || TODAY, status: id ? getTask(id).status : 'open', createdAt: id ? getTask(id).createdAt : TODAY }; const index = currentUser.tasks.findIndex(item => item.id === id); if (index >= 0) currentUser.tasks[index] = task; else currentUser.tasks.unshift(task); persist(); renderApp(); closeModal('taskModal'); toast(id ? 'Đã lưu thay đổi nhiệm vụ.' : 'Đã thêm nhiệm vụ và cập nhật lịch thông minh.'); }
function deleteTask() {
  const id = $('#taskId').value;
  if (!id) return;
  currentUser.tasks = currentUser.tasks.filter(task => task.id !== id);
  if (notificationScheduler) {
    try { notificationScheduler.handleItemDeleted('task', id); } catch (e) {}
  }
  persist();
  renderApp();
  closeModal('taskModal');
  toast('Đã xoá nhiệm vụ.');
}

function openSubjectModal(subject = null) { $('#subjectModalTitle').textContent = subject ? 'Chỉnh sửa môn học' : 'Thêm môn học'; $('#subjectId').value = subject?.id || ''; $('#subjectName').value = subject?.name || ''; $('#subjectTarget').value = subject?.target || ''; $('#subjectFirstTopic').value = ''; $('#subjectFirstTopic').parentElement.hidden = Boolean(subject); $('#deleteSubjectButton').hidden = !subject; openModal('subjectModal'); }
function saveSubject(event) { event.preventDefault(); const id = $('#subjectId').value; const name = $('#subjectName').value.trim(); if (!name) return; if (id) { const subject = getSubject(id); subject.name = name; subject.target = $('#subjectTarget').value.trim(); } else { const meta = SUBJECT_METADATA[name] || { color: 'custom', icon: name.slice(0, 1).toUpperCase() }; const firstTopic = $('#subjectFirstTopic').value.trim() || meta.defaultTopic; currentUser.subjects.push({ id: uid('subject'), name, target: $('#subjectTarget').value.trim(), color: meta.color, icon: meta.icon, topics: firstTopic ? [{ id: uid('topic'), name: firstTopic, mastery: 50, quiz: {} }] : [] }); } persist(); renderApp(); closeModal('subjectModal'); toast(id ? 'Đã lưu môn học.' : 'Đã thêm môn học.'); }
function deleteSubject() { const id = $('#subjectId').value; if (!id) return; const topicIds = getSubject(id).topics.map(topic => topic.id); currentUser.subjects = currentUser.subjects.filter(subject => subject.id !== id); currentUser.tasks = currentUser.tasks.filter(task => task.subjectId !== id); currentUser.sessions = currentUser.sessions.filter(session => !topicIds.includes(session.topicId)); currentUser.reviewSchedules = currentUser.reviewSchedules.filter(review => !topicIds.includes(review.topicId)); persist(); renderApp(); closeModal('subjectModal'); toast('Đã xoá môn học và dữ liệu liên quan.'); }
function openTopicModal(subjectId, topic = null) { $('#topicModalTitle').textContent = topic ? 'Chỉnh sửa chủ đề' : 'Thêm chủ đề'; $('#topicSubjectId').value = subjectId; $('#topicId').value = topic?.id || ''; $('#topicName').value = topic?.name || ''; $('#topicMastery').value = topic?.mastery || 50; $('#topicMasteryOutput').textContent = `${topic?.mastery || 50}%`; $('#deleteTopicButton').hidden = !topic; openModal('topicModal'); }
function saveTopic(event) { event.preventDefault(); const subject = getSubject($('#topicSubjectId').value); const id = $('#topicId').value; const name = $('#topicName').value.trim(); if (!subject || !name) return; const entry = { id: id || uid('topic'), name, mastery: Number($('#topicMastery').value), quiz: id ? getTopic(id).quiz || {} : {} }; const index = subject.topics.findIndex(topic => topic.id === id); if (index >= 0) subject.topics[index] = entry; else subject.topics.push(entry); persist(); renderApp(); closeModal('topicModal'); toast(id ? 'Đã cập nhật chủ đề.' : 'Đã thêm chủ đề.'); }
function deleteTopic() { const subject = getSubject($('#topicSubjectId').value); const id = $('#topicId').value; if (!subject || !id) return; subject.topics = subject.topics.filter(topic => topic.id !== id); currentUser.tasks = currentUser.tasks.filter(task => task.topicId !== id); currentUser.sessions = currentUser.sessions.filter(session => session.topicId !== id); currentUser.reviewSchedules = currentUser.reviewSchedules.filter(review => review.topicId !== id); persist(); renderApp(); closeModal('topicModal'); toast('Đã xoá chủ đề và lịch ôn liên quan.'); }

function normalizeScheduleState() {
  if (!Array.isArray(currentUser.scheduleChanges)) currentUser.scheduleChanges = [];
  currentUser.fixedSchedules.forEach(item => { if (typeof item.flexible !== 'boolean') item.flexible = false; });
}
function selectedFixedDays() { return $$('#fixedDays button.chosen').map(button => Number(button.dataset.day)); }
function createFixedDraft() {
  const title = $('#fixedTitle').value.trim(); const start = $('#fixedStart').value; const end = $('#fixedEnd').value;
  return { title, start, end, type: $('#fixedType').value, flexible: $('#fixedFlexible').checked, days: selectedFixedDays() };
}
function expandFixedDraft(draft, changeId = null) {
  return draft.days.map(day => ({
    id: uid('fixed'),
    title: draft.title,
    day,
    type: draft.type,
    start: draft.start,
    end: draft.end,
    flexible: Boolean(draft.flexible),
    replacementChangeId: changeId,
    recurrence: {
      frequency: 'WEEKLY',
      interval: 1,
      daysOfWeek: [day]
    },
    exceptions: []
  }));
}
function overlaps(first, second) { return minFromTime(first.start) < minFromTime(second.end) && minFromTime(second.start) < minFromTime(first.end); }
function allScheduleSlots() { const flexiblePlan = createPlan().plan.map(item => ({ id: `study-${item.id}`, title: item.title, day: 4, start: item.start, end: item.end, type: 'study', flexible: true, isStudyPlan: true })); return [...currentUser.fixedSchedules, ...flexiblePlan]; }
function scheduleConflicts(entries, ignoreIds = []) { const slots = allScheduleSlots().filter(slot => !ignoreIds.includes(slot.id)); return entries.flatMap(entry => slots.filter(slot => Number(slot.day) === Number(entry.day) && overlaps(entry, slot)).map(slot => ({ entry, slot }))); }
function nearbyDays(day) { const ordered = []; for (let offset = 1; offset <= 6; offset += 1) { const before = (day - offset + 7) % 7; const after = (day + offset) % 7; if (!ordered.includes(before)) ordered.push(before); if (!ordered.includes(after)) ordered.push(after); } return ordered.filter(item => currentUser.availability.days.includes(item)); }
function freeSegments(day, ignoreIds = []) { const busy = allScheduleSlots().filter(slot => Number(slot.day) === Number(day) && !ignoreIds.includes(slot.id)).sort((a, b) => minFromTime(a.start) - minFromTime(b.start)); const segments = []; let cursor = minFromTime(currentUser.availability.start); const end = minFromTime(currentUser.availability.end); busy.forEach(slot => { const slotStart = minFromTime(slot.start); const slotEnd = minFromTime(slot.end); if (slotStart > cursor) segments.push({ start: cursor, end: Math.min(slotStart, end) }); cursor = Math.max(cursor, slotEnd); }); if (cursor < end) segments.push({ start: cursor, end }); return segments.filter(segment => segment.end > segment.start); }
function alternativesForConflict(draft, conflicts) {
  const duration = minFromTime(draft.end) - minFromTime(draft.start); const conflictDays = [...new Set(conflicts.map(item => item.entry.day))]; const safeEntries = expandFixedDraft({ ...draft, days: draft.days.filter(day => !conflictDays.includes(day)) }); const suggestions = [];
  if (draft.flexible) {
    const replacements = []; let allFound = true;
    conflictDays.forEach(day => { const segment = freeSegments(day).find(item => item.end - item.start >= duration); if (!segment) allFound = false; else replacements.push({ id: uid('fixed'), title: draft.title, day, type: draft.type, start: timeFromMin(segment.start), end: timeFromMin(segment.start + duration), flexible: true }); });
    if (allFound && replacements.length) suggestions.push({ type: 'same-day', label: `Giữ các ngày đã chọn · đổi ca trống gần nhất`, detail: replacements.map(item => `${dayNames[item.day]} ${item.start}–${item.end}`).join(' · '), entries: [...safeEntries, ...replacements] });
  }
  const usedDays = new Set(safeEntries.map(item => item.day)); const replacements = []; let allFound = true;
  conflictDays.forEach(day => { const candidate = nearbyDays(day).find(candidateDay => !usedDays.has(candidateDay) && !scheduleConflicts([{ start: draft.start, end: draft.end, day: candidateDay }]).length); if (candidate === undefined) allFound = false; else { usedDays.add(candidate); replacements.push({ id: uid('fixed'), title: draft.title, day: candidate, type: draft.type, start: draft.start, end: draft.end, flexible: draft.flexible }); } });
  if (allFound && replacements.length) suggestions.push({ type: 'near-day', label: `Đổi sang ngày gần nhất · giữ ${draft.start}–${draft.end}`, detail: replacements.map(item => `${dayNames[item.day]}`).join(' · '), entries: [...safeEntries, ...replacements] });
  if (!suggestions.length) {
    const replacement = []; const usedFallbackDays = new Set(safeEntries.map(item => item.day));
    conflictDays.forEach(day => { const candidate = currentUser.availability.days.find(candidateDay => !usedFallbackDays.has(candidateDay) && freeSegments(candidateDay).some(segment => segment.end - segment.start >= duration)); const segment = candidate === undefined ? null : freeSegments(candidate).find(item => item.end - item.start >= duration); if (segment) { usedFallbackDays.add(candidate); replacement.push({ id: uid('fixed'), title: draft.title, day: candidate, type: draft.type, start: timeFromMin(segment.start), end: timeFromMin(segment.start + duration), flexible: true }); } });
    if (replacement.length === conflictDays.length) suggestions.push({ type: 'free-slot', label: 'Dùng các khoảng trống đủ thời lượng', detail: replacement.map(item => `${dayNames[item.day]} ${item.start}–${item.end}`).join(' · '), entries: [...safeEntries, ...replacement] });
  }
  return suggestions;
}
function showConflictHint() {
  if (!$('#fixedTitle').value.trim() || !selectedFixedDays().length || !$('#fixedStart').value || !$('#fixedEnd').value) { $('#fixedConflictHint').hidden = true; return; }
  const draft = createFixedDraft(); if (minFromTime(draft.end) <= minFromTime(draft.start)) { $('#fixedConflictHint').hidden = false; $('#fixedConflictHint').textContent = 'Giờ kết thúc cần sau giờ bắt đầu.'; return; }
  const conflicts = scheduleConflicts(expandFixedDraft(draft)); const hint = $('#fixedConflictHint'); hint.hidden = !conflicts.length;
  if (conflicts.length) { const unique = conflicts.slice(0, 2).map(item => `${item.slot.title} ${item.slot.start}–${item.slot.end} ${dayNames[item.entry.day]}`).join('; '); hint.textContent = `Có xung đột: ${unique}. TB sẽ gợi ý khung thay thế trước khi lưu.`; }
}
function renderConflictModal() {
  const { draft, conflicts, alternatives } = pendingScheduleConflict; const unique = []; conflicts.forEach(item => { const key = `${item.slot.id}-${item.entry.day}`; if (!unique.some(entry => entry.key === key)) unique.push({ key, ...item }); });
  $('#conflictTitle').textContent = `“${draft.title}” đang bị kẹt.`; $('#conflictIntro').textContent = `${draft.days.length > 1 ? 'Một hoặc nhiều ngày đã chọn' : 'Khung giờ đã chọn'} trùng với lịch có sẵn. Lịch mới chưa được lưu.`;
  $('#conflictList').innerHTML = unique.map(item => `<div class="conflict-row"><i></i><p><b>Bị trùng ${escapeHTML(item.slot.title)}</b><br>${item.slot.start}–${item.slot.end} · ${dayNames[item.entry.day]}${item.slot.isStudyPlan ? ' · phiên TB đề xuất' : ''}</p></div>`).join('');
  $('#alternativeList').innerHTML = alternatives.length ? alternatives.map((alternative, index) => `<label class="alternative-card ${index === 0 ? 'selected' : ''}"><input type="radio" name="scheduleAlternative" value="${index}" ${index === 0 ? 'checked' : ''}><span><strong>${escapeHTML(alternative.label)}</strong><small>${escapeHTML(alternative.detail)}</small></span><em class="alternative-kind">${alternative.type === 'same-day' ? 'Đổi ca' : alternative.type === 'near-day' ? 'Đổi ngày' : 'Khoảng trống'}</em></label>`).join('') : '<div class="empty-state">Chưa tìm thấy khoảng trống tự động. Bạn có thể quay lại đổi thời gian hoặc bỏ qua lịch này.</div>';
  $('#applyAlternative').disabled = !alternatives.length;
}
function openFixedModal() { $('#fixedForm').reset(); $('#fixedStart').value = '18:00'; $('#fixedEnd').value = '19:30'; $('#fixedType').value = 'tutoring'; $$('#fixedDays button').forEach(button => button.classList.toggle('chosen', [1, 4].includes(Number(button.dataset.day)))); $('#fixedConflictHint').hidden = true; openModal('fixedModal'); }
function saveFixed(event) {
  event.preventDefault(); normalizeScheduleState(); const draft = createFixedDraft();
  if (!draft.title || !draft.days.length) { toast('Hãy đặt tên và chọn ít nhất một ngày cho lịch này.'); return; }
  if (minFromTime(draft.end) <= minFromTime(draft.start)) { toast('Giờ kết thúc cần sau giờ bắt đầu.'); return; }
  const originalEntries = expandFixedDraft(draft); const conflicts = scheduleConflicts(originalEntries);
  if (conflicts.length) { pendingScheduleConflict = { draft, originalEntries, conflicts, alternatives: alternativesForConflict(draft, conflicts) }; closeModal('fixedModal'); renderConflictModal(); openModal('conflictModal'); return; }
  currentUser.fixedSchedules.push(...originalEntries); persist(); renderApp(); closeModal('fixedModal'); toast('Đã thêm lịch cố định. TB sẽ không xếp phiên học chồng lên lịch này.');
}
function applyAlternative() {
  if (!pendingScheduleConflict) return; const selected = Number($('input[name="scheduleAlternative"]:checked')?.value); const alternative = pendingScheduleConflict.alternatives[selected]; if (!alternative) return;
  normalizeScheduleState(); const changeId = uid('schedule-change'); const replacement = alternative.entries.map(entry => ({ ...entry, id: uid('fixed'), replacementChangeId: changeId }));
  currentUser.fixedSchedules.push(...replacement); currentUser.scheduleChanges.unshift({ id: changeId, createdAt: TODAY, status: 'replacement-active', original: pendingScheduleConflict.originalEntries, replacement, conflicts: pendingScheduleConflict.conflicts.map(item => item.slot.id), summary: alternative.label }); persist(); renderApp(); closeModal('conflictModal'); pendingScheduleConflict = null; toast('Đã tạo lịch thay thế. Lịch gốc vẫn được lưu để bạn hoàn tác.');
}
function discardConflict() { pendingScheduleConflict = null; closeModal('conflictModal'); toast('Chưa lưu lịch đang bị trùng.'); }
function editConflict() {
  if (!pendingScheduleConflict) return;
  const draft = pendingScheduleConflict.draft;
  closeModal('conflictModal'); openFixedModal();
  $('#fixedTitle').value = draft.title; $('#fixedType').value = draft.type; $('#fixedStart').value = draft.start; $('#fixedEnd').value = draft.end; $('#fixedFlexible').checked = draft.flexible;
  $$('#fixedDays button').forEach(button => button.classList.toggle('chosen', draft.days.includes(Number(button.dataset.day)))); showConflictHint();
}
function restoreOriginalSchedule(changeId) {
  normalizeScheduleState(); const change = currentUser.scheduleChanges.find(item => item.id === changeId); if (!change || change.status !== 'replacement-active') return;
  const replacementIds = change.replacement.map(item => item.id); const conflicts = scheduleConflicts(change.original, replacementIds);
  if (conflicts.length) { const first = conflicts[0]; toast(`Lịch gốc vẫn trùng ${first.slot.title} ${first.slot.start}–${first.slot.end} ${dayNames[first.entry.day]}.`); return; }
  currentUser.fixedSchedules = currentUser.fixedSchedules.filter(item => !replacementIds.includes(item.id)); const restored = change.original.map(item => ({ ...item, id: uid('fixed'), restoredChangeId: changeId })); currentUser.fixedSchedules.push(...restored); change.status = 'original-restored'; change.restored = restored; persist(); renderApp(); toast('Đã hoàn tác về lịch gốc.');
}
function skipFixedOccurrence(seriesId, date) {
  const event = currentUser.fixedSchedules.find(s => s.id === seriesId);
  if (!event) return;
  const targetDate = date || scheduleViewDate;
  if (RecurrenceEngineUtil && RecurrenceEngineUtil.addSkipException) {
    const updated = RecurrenceEngineUtil.addSkipException(event, targetDate);
    const idx = currentUser.fixedSchedules.findIndex(s => s.id === seriesId);
    if (idx >= 0) currentUser.fixedSchedules[idx] = updated;
  }
  if (notificationScheduler && currentUser?.settings?.reminders !== false) {
    try { notificationScheduler.reconcile(currentUser); } catch (e) {}
  }
  persist();
  renderApp();
  toast(`Đã bỏ qua ca “${escapeHTML(event.title)}” vào ngày ${targetDate}.`);
}
function deleteFixed(id) {
  currentUser.fixedSchedules = currentUser.fixedSchedules.filter(event => event.id !== id);
  if (notificationScheduler) {
    try { notificationScheduler.handleItemDeleted('event', id); } catch (e) {}
  }
  persist();
  renderApp();
  toast('Đã xoá lịch cố định.');
}
function openAvailability() { $('#availabilityStart').value = currentUser.availability.start; $('#availabilityEnd').value = currentUser.availability.end; $$('#availabilityDays button').forEach(button => button.classList.toggle('chosen', currentUser.availability.days.includes(Number(button.dataset.day)))); openModal('availabilityModal'); }
function saveAvailability(event) { event.preventDefault(); const days = $$('#availabilityDays button.chosen').map(button => Number(button.dataset.day)); if (!days.length || minFromTime($('#availabilityEnd').value) <= minFromTime($('#availabilityStart').value)) { toast('Hãy chọn ít nhất một ngày và khung giờ hợp lệ.'); return; } currentUser.availability = { start: $('#availabilityStart').value, end: $('#availabilityEnd').value, days }; persist(); renderApp(); closeModal('availabilityModal'); toast('Đã lưu khung giờ rảnh và sắp lại các phiên linh hoạt.'); }
function openProfile() { $('#profileName').value = currentUser.profile.name; $('#profileGrade').value = currentUser.profile.grade; $('#profileGoal').value = currentUser.profile.goal; $('#profileTimezone').value = currentUser.profile.timezone; openModal('profileModal'); }
function saveProfile(event) { event.preventDefault(); Object.assign(currentUser.profile, { name: $('#profileName').value.trim(), grade: $('#profileGrade').value.trim(), goal: $('#profileGoal').value.trim(), timezone: $('#profileTimezone').value }); persist(); renderApp(); closeModal('profileModal'); toast('Đã lưu hồ sơ học tập.'); }
function openQuickLog() { const topics = currentUser.subjects.flatMap(subject => subject.topics.map(topic => ({ ...topic, subject }))); if (!topics.length) { toast('Hãy thêm chủ đề trước khi ghi phiên học.'); showPage('subjects'); return; } $('#logTopic').innerHTML = topics.map(topic => `<option value="${topic.id}">${escapeHTML(topic.subject.name)} · ${escapeHTML(topic.name)}</option>`).join(''); openModal('quickLogModal'); }
function saveQuickLog(event) {
  event.preventDefault();
  const timerCompletion = pendingTimerCompletion;
  saveSession({
    topicId: timerCompletion?.topicId || $('#logTopic').value,
    minutes: timerCompletion?.minutes || $('#logMinutes').value,
    understanding: $('#logUnderstanding').value,
    taskId: timerCompletion?.taskId || null
  });
  pendingTimerCompletion = null;
  $('#logTopic').disabled = false;
  $('#logMinutes').disabled = false;
  $('#quickLogTitle').textContent = 'Bạn vừa học thế nào?';
  closeModal('quickLogModal');
  toast('Đã lưu phiên học và cập nhật lịch ôn.');
}

function calculateRisk(extraTests = 0) { const workload = openTasks().reduce((sum, task) => sum + task.minutes, 0) + extraTests * 90; const days = Math.max(1, currentUser.availability.days.length); const weeklyCapacity = (minFromTime(currentUser.availability.end) - minFromTime(currentUser.availability.start)) * days; const missed = currentUser.sessions.filter(session => session.status === 'missed').length; return Math.max(5, Math.min(88, Math.round(6 + (workload / Math.max(1, weeklyCapacity)) * 66 + Math.min(12, missed * 3)))); }
function runSimulation() { const text = $('#whatIfInput').value.trim(); if (!text) { toast('Hãy mô tả một thay đổi để TB mô phỏng.'); return; } const number = Number((text.match(/\d+/) || ['1'])[0]); const currentRisk = calculateRisk(number); const newRisk = Math.max(5, Math.round(currentRisk * .42)); const first = openTasks()[0]; const plan = first ? `Đưa “${first.title}” vào phiên sớm nhất, sau đó tách ${number > 1 ? `${number} phiên` : '1 phiên'} ôn ngắn 45 phút trong khung giờ rảnh.` : 'Tạo các phiên ôn ngắn trong khung giờ rảnh bạn đã chọn.'; $('#simulationResult').hidden = false; $('#simulationResult').innerHTML = `<div class="risk-comparison"><div><p>Lịch hiện tại</p><strong>${currentRisk}<small>%</small></strong><span>nguy cơ trễ</span></div><div class="risk-arrow">→</div><div class="improved"><p>Phương án mới</p><strong>${newRisk}<small>%</small></strong><span>nguy cơ trễ</span></div></div><p class="plan-summary"><b>Đề xuất:</b> ${escapeHTML(plan)} Lịch cố định vẫn được giữ nguyên.</p><button class="apply-plan" id="applyPlan">Áp dụng phương án mới</button>`; $('#runSimulation').disabled = true; $('#runSimulation').innerHTML = 'Đã tạo phương án <span>✓</span>'; }
function applySimulation() { const text = $('#whatIfInput').value.trim(); const number = Number((text.match(/\d+/) || ['1'])[0]); const oldRisk = calculateRisk(number); currentUser.lastSimulation = { summary: `Ưu tiên thêm ${number} phiên ôn ngắn, nguy cơ trễ giảm từ ${oldRisk}% xuống ${Math.max(5, Math.round(oldRisk * .42))}%.`, appliedAt: TODAY }; persist(); renderApp(); closeModal('whatIfModal'); showPage('schedule'); toast('Đã áp dụng phương án mới vào lịch linh hoạt.'); }

function loginSuccess() {
  $('#loginError').hidden = true;
  $('#authView').hidden = true;
  $('#appShell').hidden = false;
  activePage = 'home';
  renderApp();
  if (notificationScheduler && currentUser) {
    notificationScheduler.start(() => currentUser, 30000);
  }
  if (!currentUser.onboarded) {
    resetOnboarding();
    openModal('onboardingModal');
  }
}

async function signIn(email, password) {
  const normEmail = email.trim().toLowerCase();
  try {
    // Server sets TB-auth-token HttpOnly cookie; response body has { ok, user } — no token.
    const { user } = await api('POST', '/login', { email: normEmail, password });
    currentUser = user;
    // Ensure we're not accidentally in offline mode
    setOfflineSession(null);
    localStorage.removeItem(STORAGE_LOCAL_CURRENT);
    saveLocalUser(user);
    loginSuccess();
  } catch (err) {
    if (err.message === 'OFFLINE_MODE') {
      // Network unavailable — fall back to local demo accounts
      const accounts = getLocalAccounts();
      const account = accounts.find(item => item.email.toLowerCase() === normEmail && item.password === password);
      if (!account) {
        $('#loginError').textContent = 'Email hoặc mật khẩu chưa đúng. Bạn có thể dùng tài khoản mẫu bên dưới.';
        $('#loginError').hidden = false;
        return;
      }
      currentUser = clone(account);
      setOfflineSession('local-' + account.id);
      localStorage.setItem(STORAGE_LOCAL_CURRENT, account.id);
      loginSuccess();
      return;
    }
    $('#loginError').textContent = err.message;
    $('#loginError').hidden = false;
  }
}

async function logout() {
  if (timerRunning) toggleTimer();
  if (notificationScheduler) {
    notificationScheduler.stop();
  }
  // Ask the server to clear the HttpOnly cookie
  if (!isOfflineMode()) {
    try { await api('POST', '/logout'); } catch { /* ignore — clear local state regardless */ }
  }
  // Always clear local offline state
  setOfflineSession(null);
  localStorage.removeItem(STORAGE_LOCAL_CURRENT);
  currentUser = null;
  $('#appShell').hidden = true;
  $('#authView').hidden = false;
  $$('.modal-backdrop.open').forEach(modal => closeModal(modal.id));
  $('#loginPassword').value = '';
  toast('Đã đăng xuất.');
}
function syncOnboardingCombosUI() {
  const chosenArray = [...onboardingChosenSubjects].sort();
  let matchedCombo = null;
  for (const [code, subs] of Object.entries(EXAM_COMBINATIONS)) {
    if (subs.length === chosenArray.length && [...subs].sort().every((s, i) => s === chosenArray[i])) {
      matchedCombo = code;
      break;
    }
  }
  $$('#onboardingCombos button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.combo === matchedCombo);
  });
  $$('#onboardingSubjects button').forEach(btn => {
    btn.classList.toggle('chosen', onboardingChosenSubjects.has(btn.dataset.subjectChoice));
  });
}

function resetOnboarding() {
  onboardingStep = 1;
  onboardingChosenSubjects = new Set(EXAM_COMBINATIONS['A00']);
  onboardingChosenDays = new Set([1, 2, 3, 4, 5]);
  $$('.onboarding-step').forEach(step => step.classList.toggle('active', Number(step.dataset.onboardingStep) === 1));
  $$('.onboarding-dots i').forEach((dot, index) => dot.classList.toggle('active', index === 0));
  $('#onboardingNext').innerHTML = 'Tiếp tục <span>→</span>';
  syncOnboardingCombosUI();
  $$('#onboardingDays button').forEach(button => button.classList.toggle('chosen', onboardingChosenDays.has(Number(button.dataset.day))));
}

function advanceOnboarding() {
  if (onboardingStep === 2 && onboardingChosenSubjects.size === 0) {
    toast('Hãy chọn ít nhất một môn học hoặc tổ hợp thi.');
    return;
  }
  if (onboardingStep < 4) {
    onboardingStep += 1;
    $$('.onboarding-step').forEach(step => step.classList.toggle('active', Number(step.dataset.onboardingStep) === onboardingStep));
    $$('.onboarding-dots i').forEach((dot, index) => dot.classList.toggle('active', index < onboardingStep));
    $('#onboardingNext').innerHTML = onboardingStep === 4 ? 'Tạo kế hoạch đầu tiên <span>✦</span>' : 'Tiếp tục <span>→</span>';
    return;
  }
  currentUser.profile.grade = $('#onboardingGrade').value.trim();
  currentUser.profile.goal = $('#onboardingGoal').value.trim();
  currentUser.availability = { start: $('#onboardingStart').value, end: $('#onboardingEnd').value, days: [...onboardingChosenDays] };
  currentUser.subjects = [...onboardingChosenSubjects].map(name => {
    const meta = SUBJECT_METADATA[name] || { color: 'math', icon: '✦', defaultTopic: 'Chủ đề đầu tiên' };
    return {
      id: uid('subject'),
      name,
      target: `Mục tiêu điểm cao môn ${name}`,
      color: meta.color,
      icon: meta.icon,
      topics: [{
        id: uid('topic'),
        name: meta.defaultTopic,
        mastery: 50,
        quiz: {}
      }]
    };
  });
  currentUser.onboarded = true;
  persist();
  renderApp();
  closeModal('onboardingModal');
  toast('Kế hoạch đầu tiên đã sẵn sàng. Hãy thêm nhiệm vụ để TB ưu tiên lịch.');
}
async function createProfile(event) {
  event.preventDefault();
  const email = $('#createEmail').value.trim().toLowerCase();
  const password = $('#createPassword').value;
  const name = $('#createName').value.trim();
  try {
    // Server sets TB-auth-token cookie; response body has { ok, user } — no token.
    const { user } = await api('POST', '/register', { name, email, password });
    setOfflineSession(null);
    localStorage.removeItem(STORAGE_LOCAL_CURRENT);
    currentUser = user;
    saveLocalUser(user);
    closeModal('loginProfileModal');
    loginSuccess();
    toast('Tài khoản đã được tạo!');
  } catch (err) {
    if (err.message === 'OFFLINE_MODE') {
      const accounts = getLocalAccounts();
      if (accounts.some(a => a.email.toLowerCase() === email)) {
        toast('Email này đã tồn tại. Hãy đăng nhập hoặc dùng email khác.');
        return;
      }
      const newAcc = blankAccount({ id: uid('user'), email, name });
      newAcc.password = password;
      saveLocalUser(newAcc);
      currentUser = clone(newAcc);
      setOfflineSession('local-' + newAcc.id);
      localStorage.setItem(STORAGE_LOCAL_CURRENT, newAcc.id);
      closeModal('loginProfileModal');
      loginSuccess();
      toast('Tài khoản đã được tạo thành công!');
      return;
    }
    toast(err.message);
  }
}
function exportData() { const blob = new Blob([JSON.stringify(currentUser, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `TB-${currentUser.profile.name.toLowerCase().replace(/\s+/g, '-')}.json`; link.click(); URL.revokeObjectURL(url); toast('Đã xuất bản sao lưu dữ liệu.'); }
function resetDemo() { if (!window.confirm('Khôi phục dữ liệu mẫu? Các thay đổi của tài khoản hiện tại sẽ bị thay thế.')) return; const replacement = seedAccount(); replacement.id = currentUser.id; replacement.email = currentUser.email; currentUser = replacement; persist(); renderApp(); toast('Đã khôi phục dữ liệu mẫu cho tài khoản này.'); }
function updateNotificationBadge() {
  const notifBtn = $('#notificationButton');
  if (!notifBtn) return;
  const unreadCount = notificationStore ? notificationStore.getUnreadCount() : 0;
  let badge = notifBtn.querySelector('.notification-badge-count');
  let dot = notifBtn.querySelector('b');

  if (unreadCount > 0) {
    if (dot) dot.style.display = 'none';
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notification-badge-count';
      notifBtn.appendChild(badge);
    }
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badge.style.display = 'block';
  } else {
    if (badge) badge.style.display = 'none';
    if (dot) dot.style.display = '';
  }
}

function renderNotificationPopover(popover) {
  const notifs = notificationStore ? notificationStore.getAll(true) : [];
  const unreadCount = notificationStore ? notificationStore.getUnreadCount() : 0;

  const headerHtml = `
    <div class="notification-popover-header">
      <h3>Thông báo ${unreadCount > 0 ? `(${unreadCount} mới)` : ''}</h3>
      ${notifs.length ? `<button type="button" class="notification-popover-clear" id="markAllReadBtn">Đã đọc tất cả</button>` : ''}
    </div>
  `;

  let bodyHtml = '';
  if (!notifs.length) {
    // Fallback: Show today's quick summary
    const review = currentUser?.reviewSchedules?.filter(item => item.status === 'scheduled' && item.due <= TODAY)[0];
    const topic = review && getTopic(review.topicId);
    bodyHtml = `
      <div style="padding: 16px;">
        <p style="margin: 0 0 8px; font-size: 11px; color: #555;">
          <b>${topic ? `Ôn lại ${escapeHTML(topic.name)}` : 'Chưa có thông báo mới'}</b><br>
          ${topic ? 'Đúng lịch spaced repetition đã lưu.' : 'TB sẽ nhắc khi sắp đến giờ học hoặc có bài quá hạn.'}
        </p>
        <p style="margin: 0; font-size: 10px; color: #888;">${openTasks().length} nhiệm vụ đang mở</p>
      </div>
    `;
  } else {
    bodyHtml = `<ul class="notification-popover-list">` + notifs.slice(0, 8).map(n => `
      <li class="notification-popover-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}">
        <div class="notification-popover-item-head">
          <span>${n.sourceType ? n.sourceType.toUpperCase() : 'HỆ THỐNG'}</span>
          <time>${DateUtil ? DateUtil.formatShortDate(n.createdAt.split('T')[0]) : ''}</time>
        </div>
        <p class="notification-popover-item-title">${escapeHTML(n.title)}</p>
        <p class="notification-popover-item-msg">${escapeHTML(n.message)}</p>
      </li>
    `).join('') + `</ul>`;
  }

  popover.innerHTML = headerHtml + bodyHtml;

  const markAllBtn = popover.querySelector('#markAllReadBtn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', () => {
      if (notificationStore) {
        notificationStore.markAllAsRead();
        updateNotificationBadge();
        renderNotificationPopover(popover);
      }
    });
  }

  popover.querySelectorAll('.notification-popover-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.notifId;
      if (id && notificationStore) {
        notificationStore.markAsRead(id);
        updateNotificationBadge();
        item.classList.remove('unread');
      }
    });
  });
}

function toggleNotification() {
  let popover = $('#notificationPopover');
  if (!popover) {
    popover = document.createElement('aside');
    popover.id = 'notificationPopover';
    popover.className = 'notification-popover';
    document.body.append(popover);
  }

  renderNotificationPopover(popover);
  popover.classList.toggle('open');
}

// Auto-login: try to resume a session from the HttpOnly cookie first,
// then fall back to the offline session marker for demo/local accounts.
(async function autoLogin() {
  // ── Offline/demo mode ────────────────────────────────────────────────────
  const offlineSession = getOfflineSession();
  if (offlineSession && offlineSession.startsWith('local-')) {
    const userId = offlineSession.replace(/^local-/, '');
    const account = getLocalAccounts().find(a => a.id === userId);
    if (account) {
      currentUser = clone(account);
      loginSuccess();
    } else {
      // Session marker references a deleted account — clean up
      setOfflineSession(null);
    }
    return;
  }

  // ── Server/cookie mode ───────────────────────────────────────────────────
  // Try to restore from the HttpOnly TB-auth-token cookie.
  // credentials:'include' in api() ensures the cookie is sent.
  if (window.location.protocol === 'file:') return; // no server in file:// mode

  try {
    const { user } = await api('GET', '/user');
    currentUser = user;
    saveLocalUser(user);
    loginSuccess();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      // Cookie expired or invalid — ensure it's cleared on the server too
      try { await api('POST', '/logout'); } catch { /* ignore */ }
      return; // show login screen
    }
    if (err.message === 'OFFLINE_MODE') {
      // Network unavailable — try to restore the last remembered local user
      const rememberedId = localStorage.getItem(STORAGE_LOCAL_CURRENT);
      const account = getLocalAccounts().find(a => a.id === rememberedId);
      if (account) {
        currentUser = clone(account);
        setOfflineSession('local-' + account.id);
        loginSuccess();
      }
      return;
    }
    // Any other error (e.g. 5xx) — show login, do not clear anything
  }
})();

$('#loginForm').addEventListener('submit', event => { event.preventDefault(); signIn($('#loginEmail').value, $('#loginPassword').value); });
$('#fillDemo').addEventListener('click', () => { $('#loginEmail').value = DEMO_EMAIL; $('#loginPassword').value = DEMO_PASSWORD; $('#loginError').hidden = true; });
$('#createDemoProfile').addEventListener('click', () => openModal('loginProfileModal'));
$('#createProfileForm').addEventListener('submit', createProfile);
$('#onboardingNext').addEventListener('click', advanceOnboarding);
$('#startStudy').addEventListener('click', () => openStudy($('#startStudy').dataset.taskId));
$('#pauseTimer').addEventListener('click', toggleTimer);
$('#completeSession').addEventListener('click', completeTimer);
$('#taskForm').addEventListener('submit', saveTask); $('#deleteTaskButton').addEventListener('click', deleteTask); $('#taskSubject').addEventListener('change', () => populateTaskFields($('#taskSubject').value));
$('#subjectForm').addEventListener('submit', saveSubject); $('#deleteSubjectButton').addEventListener('click', deleteSubject);
$('#topicForm').addEventListener('submit', saveTopic); $('#deleteTopicButton').addEventListener('click', deleteTopic); $('#topicMastery').addEventListener('input', event => { $('#topicMasteryOutput').textContent = `${event.target.value}%`; });
$('#fixedForm').addEventListener('submit', saveFixed); $('#availabilityForm').addEventListener('submit', saveAvailability); $('#profileForm').addEventListener('submit', saveProfile); $('#quickLogForm').addEventListener('submit', saveQuickLog); $('#runSimulation').addEventListener('click', runSimulation);
['input', 'change'].forEach(eventName => $('#fixedForm').addEventListener(eventName, showConflictHint));
$('#fixedDays').addEventListener('click', event => { const button = event.target.closest('button[data-day]'); if (!button) return; button.classList.toggle('chosen'); showConflictHint(); });
$('#discardConflict').addEventListener('click', discardConflict); $('#editConflict').addEventListener('click', editConflict); $('#applyAlternative').addEventListener('click', applyAlternative);
$('#alternativeList').addEventListener('change', () => { $$('.alternative-card', $('#alternativeList')).forEach(card => card.classList.toggle('selected', $('input', card).checked)); });
$('#fixedScheduleButton').addEventListener('click', openFixedModal); $('#fixedScheduleButtonSecondary').addEventListener('click', openFixedModal); $('#availabilityButton').addEventListener('click', openAvailability); $('#addSubjectButton').addEventListener('click', () => openSubjectModal()); $('#addTaskButton').addEventListener('click', () => openTaskModal()); $('#logSessionButton').addEventListener('click', openQuickLog); $('#refreshInsights').addEventListener('click', () => { renderInsights(); toast('Đã cập nhật insight từ dữ liệu hiện có.'); }); $('#exportData').addEventListener('click', exportData); $('#resetDemo').addEventListener('click', resetDemo); $('#notificationButton').addEventListener('click', toggleNotification);
$('#accountButton').addEventListener('click', () => openModal('accountModal')); $('#profileShortcut').addEventListener('click', () => openModal('accountModal')); $('#logoutButton').addEventListener('click', logout); $('#openProfileFromAccount').addEventListener('click', () => { closeModal('accountModal'); openProfile(); });

/* New feature event listeners */
$('#takeNoteForm').addEventListener('submit', saveTakeNote);
$('#addMilestoneForm').addEventListener('submit', addMilestone);
$('#timetableFileInput').addEventListener('change', e => { if (e.target.files?.[0]) handleTimetableFile(e.target.files[0]); });
$('#notePhotoInput').addEventListener('change', e => { if (e.target.files?.[0]) processNotePhoto(e.target.files[0]); });

// Prevent browser from opening/downloading dropped files when dropped outside dropzone
window.addEventListener('dragover', e => { e.preventDefault(); }, false);
window.addEventListener('drop', e => { e.preventDefault(); }, false);

const timetableDropzone = $('#timetableDropzone');
const importModal = $('#importTimetableModal');

if (timetableDropzone) {
  timetableDropzone.addEventListener('click', (e) => {
    if (e.target !== $('#timetableFileInput')) {
      $('#timetableFileInput').click();
    }
  });

  ['dragenter', 'dragover'].forEach(name => {
    timetableDropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      timetableDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'dragend'].forEach(name => {
    timetableDropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      timetableDropzone.classList.remove('dragover');
    });
  });

  timetableDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    timetableDropzone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files[0]) handleTimetableFile(files[0]);
  });
}

if (importModal) {
  importModal.addEventListener('dragover', (e) => {
    e.preventDefault();
    timetableDropzone?.classList.add('dragover');
  });
  importModal.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!e.relatedTarget || !importModal.contains(e.relatedTarget)) {
      timetableDropzone?.classList.remove('dragover');
    }
  });
  importModal.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    timetableDropzone?.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files[0]) handleTimetableFile(files[0]);
  });
}

// Global page drop: if user drops a TKB file anywhere on the web app, auto-open modal and process
document.addEventListener('drop', (e) => {
  const files = e.dataTransfer?.files;
  if (files && files[0]) {
    const ext = files[0].name.split('.').pop().toLowerCase();
    if (['docx', 'doc', 'png', 'jpg', 'jpeg', 'webp', 'txt'].includes(ext)) {
      e.preventDefault();
      e.stopPropagation();
      openTimetableModal();
      handleTimetableFile(files[0]);
    }
  }
});

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-page]'); if (nav) showPage(nav.dataset.page);
  const openPage = event.target.closest('[data-insight-page]'); if (openPage) showPage(openPage.dataset.insightPage);
  if (event.target.closest('.show-tasks')) showPage('tasks'); if (event.target.closest('.show-schedule')) showPage('schedule'); if (event.target.closest('#whatIfButton, #openWhatIf')) { $('#whatIfInput').value = ''; $('#simulationResult').hidden = true; $('#runSimulation').disabled = false; $('#runSimulation').innerHTML = 'Xem phương án phù hợp <span>→</span>'; openModal('whatIfModal'); }
  if (event.target.closest('.mobile-menu')) $('.sidebar').classList.toggle('mobile-open');
  const taskToggle = event.target.closest('[data-toggle-task]'); if (taskToggle) toggleTask(taskToggle.dataset.toggleTask);
  const taskOpen = event.target.closest('[data-open-task]'); if (taskOpen) openTaskModal(getTask(taskOpen.dataset.openTask));
  const subjectEdit = event.target.closest('[data-edit-subject]'); if (subjectEdit) openSubjectModal(getSubject(subjectEdit.dataset.editSubject));
  const topicEdit = event.target.closest('[data-edit-topic]'); if (topicEdit) openTopicModal(topicEdit.dataset.subjectId, getTopic(topicEdit.dataset.editTopic));
  const topicAdd = event.target.closest('[data-add-topic]'); if (topicAdd) openTopicModal(topicAdd.dataset.addTopic);
  const fixedDelete = event.target.closest('[data-delete-fixed]'); if (fixedDelete) deleteFixed(fixedDelete.dataset.deleteFixed);
  const skipOccurrenceBtn = event.target.closest('[data-skip-occurrence]');
  if (skipOccurrenceBtn) {
    skipFixedOccurrence(skipOccurrenceBtn.dataset.skipOccurrence, skipOccurrenceBtn.dataset.occurrenceDate);
  }
  const restoreSchedule = event.target.closest('[data-restore-schedule]'); if (restoreSchedule) restoreOriginalSchedule(restoreSchedule.dataset.restoreSchedule);
  const completeReviewButton = event.target.closest('[data-complete-review]'); if (completeReviewButton) completeReview(completeReviewButton.dataset.completeReview);
  const settingsAction = event.target.closest('[data-settings-action]'); if (settingsAction) { if (settingsAction.dataset.settingsAction === 'profile') openProfile(); if (settingsAction.dataset.settingsAction === 'availability') openAvailability(); if (settingsAction.dataset.settingsAction === 'subjects') showPage('subjects'); }
  if (event.target.closest('#applyPlan')) applySimulation(); if (event.target.closest('#dismissCoach')) { currentUser.settings.coach = false; persist(); renderSettings(); $('#coachCard').style.display = 'none'; toast('Đã ẩn Study Coach. Bạn có thể bật lại trong Settings.'); }
  if (event.target.closest('[data-close-modal]')) closeModal(event.target.closest('[data-close-modal]').dataset.closeModal);
  const filter = event.target.closest('[data-filter]'); if (filter) { taskFilter = filter.dataset.filter; renderTasks(); }
  const comboChoice = event.target.closest('[data-combo]');
  if (comboChoice) {
    const combo = comboChoice.dataset.combo;
    if (EXAM_COMBINATIONS[combo]) {
      onboardingChosenSubjects = new Set(EXAM_COMBINATIONS[combo]);
      syncOnboardingCombosUI();
    }
  }
  const subjectChoice = event.target.closest('[data-subject-choice]');
  if (subjectChoice) {
    const name = subjectChoice.dataset.subjectChoice;
    onboardingChosenSubjects.has(name) ? onboardingChosenSubjects.delete(name) : onboardingChosenSubjects.add(name);
    syncOnboardingCombosUI();
  }
  const dayChoice = event.target.closest('.day-picker button[data-day]'); if (dayChoice) { const collection = dayChoice.closest('#onboardingDays') ? onboardingChosenDays : null; if (collection) { const day = Number(dayChoice.dataset.day); collection.has(day) ? collection.delete(day) : collection.add(day); dayChoice.classList.toggle('chosen', collection.has(day)); } else if (dayChoice.closest('#availabilityDays')) dayChoice.classList.toggle('chosen'); }
  if (!event.target.closest('#notificationButton, #notificationPopover')) $('#notificationPopover')?.classList.remove('open');

  /* Click delegates for Take Note, Timetable Import, Milestones */
  if (event.target.closest('#openTakeNoteBtn, #homeTakeNoteButton')) openTakeNoteModal();
  if (event.target.closest('#openMilestonesBtn, #manageExamsBtn')) { renderMilestonesModal(); openModal('milestoneModal'); }
  if (event.target.closest('#importTimetableButton')) openTimetableModal();
  if (event.target.closest('#browseTimetableBtn')) $('#timetableFileInput').click();
  if (event.target.closest('#applyTimetableBtn')) applyImportedTimetable();
  if (event.target.closest('#cancelImportBtn')) closeModal('importTimetableModal');

  const removePhotoBtn = event.target.closest('#removePhotoBtn');
  if (removePhotoBtn) {
    currentNotePhotoData = null;
    $('#notePhotoInput').value = '';
    $('#notePhotoImg').src = '';
    $('#photoPlaceholder').hidden = false;
    $('#photoPreviewContainer').hidden = true;
    return;
  }
  const photoBox = event.target.closest('#notePhotoBox');
  if (photoBox && !removePhotoBtn) {
    $('#notePhotoInput').click();
  }

  const milestoneDel = event.target.closest('[data-delete-milestone]');
  if (milestoneDel) deleteMilestone(milestoneDel.dataset.deleteMilestone);

  const noteDel = event.target.closest('[data-delete-note]');
  if (noteDel) deleteTakeNote(noteDel.dataset.deleteNote);

  const zoomPhoto = event.target.closest('[data-zoom-photo]');
  if (zoomPhoto) openPhotoLightbox(zoomPhoto.dataset.zoomPhoto);

  const importSlotDel = event.target.closest('[data-delete-import-slot]');
  if (importSlotDel) {
    const idx = parseInt(importSlotDel.dataset.deleteImportSlot, 10);
    parsedImportSlots.splice(idx, 1);
    renderImportPreview();
  }

  /* Quick Capture & Inbox actions (PRODUCT UX PHASE 1) */
  if (event.target.closest('#openQuickCaptureBtn, #todayQuickAddBtn, #inboxQuickAddBtn, #emptyInboxAddBtn, #fabQuickAdd')) {
    openQuickCaptureModal();
  }

  const qcChip = event.target.closest('.qc-chip');
  if (qcChip) {
    syncQcChips(qcChip.dataset.dest);
    updateQuickCapturePreview();
  }

  if (event.target.closest('#qcSubmitBtn')) {
    submitQuickCapture();
  }

  if (event.target.closest('#startRecommendedBtn')) {
    const btn = event.target.closest('#startRecommendedBtn');
    const taskId = btn.dataset.taskId;
    if (taskId) openStudy(taskId);
  }

  if (event.target.closest('#skipRecommendedBtn')) {
    toast('Đã ghi nhận, bạn có thể chọn việc khác từ danh sách nhiệm vụ hoặc Hộp thư.');
    showPage('inbox');
  }

  const inboxCheck = event.target.closest('[data-inbox-check]');
  if (inboxCheck) {
    const id = inboxCheck.dataset.inboxCheck;
    const task = getTask(id);
    if (task) {
      task.status = task.status === 'done' ? 'open' : 'done';
      persist();
      renderApp();
      toast(task.status === 'done' ? 'Đã hoàn thành việc trong Inbox!' : 'Đã mở lại công việc.');
    }
  }

  const inboxSched = event.target.closest('[data-inbox-schedule]');
  if (inboxSched) {
    const id = inboxSched.dataset.inboxSchedule;
    const task = getTask(id);
    if (task) {
      if (InboxServiceUtil) InboxServiceUtil.scheduleItem(task, TODAY);
      else { task.scheduledDate = TODAY; task.deadline = TODAY; task.isInbox = false; }
      persist();
      renderApp();
      toast(`Đã xếp "${task.title}" vào lịch Hôm nay!`, 'success');
    }
  }

  const inboxTom = event.target.closest('[data-inbox-tomorrow]');
  if (inboxTom) {
    const id = inboxTom.dataset.inboxTomorrow;
    const task = getTask(id);
    if (task) {
      const tom = DateUtil ? DateUtil.addAppDays(TODAY, 1) : TODAY;
      if (InboxServiceUtil) InboxServiceUtil.scheduleItem(task, tom);
      else { task.scheduledDate = tom; task.deadline = tom; task.isInbox = false; }
      persist();
      renderApp();
      toast(`Đã xếp "${task.title}" vào lịch Ngày mai!`, 'success');
    }
  }

  const inboxDel = event.target.closest('[data-inbox-delete]');
  if (inboxDel) {
    const id = inboxDel.dataset.inboxDelete;
    if (confirm('Bạn có chắc muốn xóa công việc này khỏi Inbox?')) {
      currentUser.tasks = (currentUser.tasks || []).filter(t => t.id !== id);
      persist();
      renderApp();
      toast('Đã xóa công việc khỏi Inbox.', 'info');
    }
  }

  if (event.target.closest('#planMyInboxBtn')) {
    openPlanInboxModal();
  }

  if (event.target.closest('#confirmPlanInboxBtn')) {
    applyProposedInboxPlan();
  }

  if (event.target.closest('#aiAskBtn')) {
    handleAiAskSubmit();
  }

  if (event.target.closest('#confirmAiPlanBtn')) {
    applyProposedAiPlan();
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'quickCaptureInput') {
    updateQuickCapturePreview();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'importClassSelect') {
    const chosen = event.target.value;
    if (detectedMultiClasses && detectedMultiClasses[chosen]) {
      selectedImportClassName = chosen;
      parsedImportSlots = mergeConsecutiveSlots(detectedMultiClasses[chosen].slots);
      $('#parsedClassLabel').textContent = `lớp ${detectedMultiClasses[chosen].label}`;
      renderImportPreview();
    }
  }
  if (event.target.id === 'reminderToggle') { currentUser.settings.reminders = event.target.checked; persist(); renderSettings(); }
  if (event.target.id === 'coachToggle') { currentUser.settings.coach = event.target.checked; persist(); renderInsights(); renderSettings(); }
});
$$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener('keydown', event => {
  if (event.target.id === 'quickCaptureInput' && event.key === 'Enter') {
    event.preventDefault();
    submitQuickCapture();
    return;
  }
  if (event.target.id === 'aiAskInput' && event.key === 'Enter') {
    event.preventDefault();
    handleAiAskSubmit();
    return;
  }
  if (event.key === 'Escape') {
    $$('.modal-backdrop.open').forEach(modal => closeModal(modal.id));
    $('#notificationPopover')?.classList.remove('open');
    return;
  }
  const activeEl = document.activeElement;
  const isInput = activeEl && (
    activeEl.tagName === 'INPUT' ||
    activeEl.tagName === 'TEXTAREA' ||
    activeEl.tagName === 'SELECT' ||
    activeEl.isContentEditable
  );
  if (!isInput) {
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      openQuickCaptureModal();
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openQuickCaptureModal();
    return;
  }
});

// Schedule date navigation (‹ › buttons)
document.addEventListener('click', event => {
  const nav = event.target.closest('.date-navigator button');
  if (!nav) return;
  if (nav.textContent.trim() === '‹') {
    scheduleViewDate = DateUtil ? DateUtil.addAppDays(scheduleViewDate, -1) : scheduleViewDate;
  } else {
    scheduleViewDate = DateUtil ? DateUtil.addAppDays(scheduleViewDate, 1) : scheduleViewDate;
  }
  renderSchedule();
});

// Calendar month navigation
document.addEventListener('click', event => {
  const btn = event.target.closest('.mini-calendar-head button');
  if (!btn) return;
  if (btn.getAttribute('aria-label') === 'Tháng trước') { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } }
  else if (btn.getAttribute('aria-label') === 'Tháng sau') { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } }
  renderCalendar();
});

// Real-time clock: update TODAY and header every minute
setInterval(() => {
  const newToday = getToday();
  if (newToday !== TODAY) { TODAY = newToday; scheduleViewDate = TODAY; if (currentUser) renderApp(); }
  if (currentUser) renderHeader();
}, 60000);
