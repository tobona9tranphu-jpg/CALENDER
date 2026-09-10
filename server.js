const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const root = __dirname;
const DATA_DIR = path.join(root, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

// In-memory session store: token -> userId
const sessions = {};

// --- Helpers ---
async function hashPassword(pw) { return bcrypt.hash(pw, 12); }
function hashLegacyPassword(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }
function readUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } }
function writeUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function getUserFromToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const userId = sessions[token];
  if (!userId) return null;
  const users = readUsers();
  return users.find(u => u.id === userId) || null;
}

// --- Seed demo account if empty ---
async function ensureSeed() {
  const users = readUsers();
  if (users.length > 0) return;
  const now = new Date();
  const relDate = (offset) => {
    const d = new Date(now); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  };
  const seed = {
    id: 'demo-minh-anh',
    email: 'minhanh@tb.demo',
    passwordHash: await hashPassword('demo123'),
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
      { id: 'task-integral', subjectId: 'math', topicId: 'integral', title: 'Làm 20 bài vận dụng Tích phân', deadline: relDate(0), minutes: 45, priority: 5, status: 'open', createdAt: relDate(-3) },
      { id: 'task-dp', subjectId: 'informatics', topicId: 'dp', title: 'Hoàn thiện bài Dynamic Programming', deadline: relDate(1), minutes: 60, priority: 4, status: 'open', createdAt: relDate(-2) },
      { id: 'task-listening', subjectId: 'ielts', topicId: 'listening', title: 'IELTS Listening · Test 3', deadline: relDate(2), minutes: 40, priority: 3, status: 'open', createdAt: relDate(-1) },
      { id: 'task-functions', subjectId: 'math', topicId: 'functions', title: 'Tóm tắt công thức hàm số', deadline: relDate(-1), minutes: 25, priority: 2, status: 'done', createdAt: relDate(-4) },
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
  writeUsers([seed]);
  console.log('Seed demo account created: minhanh@tb.demo / demo123');
}
ensureSeed().then(() => {

// --- MIME types for static files ---
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// --- HTTP Server ---
http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = req.url.split('?')[0];

  // --- API Routes ---
  if (url === '/api/register' && req.method === 'POST') {
    try {
      const { name, email, password } = await parseBody(req);
      if (!name || !email || !password) return json(res, 400, { error: 'Thiếu thông tin đăng ký.' });
      if (password.length < 4) return json(res, 400, { error: 'Mật khẩu cần ít nhất 4 ký tự.' });
      const users = readUsers();
      if (users.some(u => u.email.toLowerCase() === email.trim().toLowerCase())) {
        return json(res, 409, { error: 'Email đã tồn tại. Hãy đăng nhập hoặc dùng email khác.' });
      }
      const id = 'user-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      const newUser = {
        id, email: email.trim().toLowerCase(), passwordHash: await hashPassword(password),
        onboarded: false,
        profile: { name: name.trim(), grade: '', goal: '', timezone: 'Asia/Ho_Chi_Minh' },
        availability: { start: '15:00', end: '21:00', days: [1, 2, 3, 4, 5] },
        settings: { reminders: true, coach: true },
        subjects: [], tasks: [], fixedSchedules: [], sessions: [], reviewSchedules: [],
        studyNotes: [],
        examMilestones: [
          { id: 'm-midterm1', title: 'Thi Giữa Học Kỳ I', date: '2026-10-20', subjects: 'Các môn chính' },
          { id: 'm-final1', title: 'Thi Cuối Học Kỳ I', date: '2026-12-25', subjects: 'Tất cả các môn' },
          { id: 'm-thpt', title: 'Kỳ thi Tốt nghiệp THPT 2026', date: '2026-06-26', subjects: 'Tổ hợp thi' }
        ],
        lastSimulation: null, scheduleChanges: [],
      };
      users.push(newUser);
      writeUsers(users);
      const token = genToken();
      sessions[token] = id;
      const { passwordHash, ...safe } = newUser;
      return json(res, 201, { token, user: safe });
    } catch (e) { return json(res, 400, { error: 'Dữ liệu không hợp lệ.' }); }
  }

  if (url === '/api/login' && req.method === 'POST') {
    try {
      const { email, password } = await parseBody(req);
      if (!email || !password) return json(res, 400, { error: 'Thiếu email hoặc mật khẩu.' });
      const users = readUsers();
      const user = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user) return json(res, 401, { error: 'Email hoặc mật khẩu chưa đúng.' });
      const isBcryptHash = typeof user.passwordHash === 'string' && /^\$2[aby]?\$\d{2}\$/.test(user.passwordHash);
      const passwordMatches = isBcryptHash
        ? await bcrypt.compare(password, user.passwordHash)
        : user.passwordHash === hashLegacyPassword(password);
      if (!passwordMatches) return json(res, 401, { error: 'Email hoặc mật khẩu chưa đúng.' });
      if (!isBcryptHash) {
        user.passwordHash = await hashPassword(password);
        const userIndex = users.findIndex(item => item.id === user.id);
        users[userIndex] = user;
        writeUsers(users);
      }
      const token = genToken();
      sessions[token] = user.id;
      const { passwordHash, ...safe } = user;
      return json(res, 200, { token, user: safe });
    } catch (e) { return json(res, 400, { error: 'Dữ liệu không hợp lệ.' }); }
  }

  if (url === '/api/user' && req.method === 'GET') {
    const user = getUserFromToken(req);
    if (!user) return json(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
    const { passwordHash, ...safe } = user;
    return json(res, 200, { user: safe });
  }

  if (url === '/api/user' && req.method === 'PUT') {
    const user = getUserFromToken(req);
    if (!user) return json(res, 401, { error: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' });
    try {
      const body = await parseBody(req);
      const users = readUsers();
      const idx = users.findIndex(u => u.id === user.id);
      if (idx < 0) return json(res, 404, { error: 'Người dùng không tồn tại.' });
      // Preserve auth fields, update everything else
      const updated = { ...body, id: user.id, email: user.email, passwordHash: user.passwordHash };
      users[idx] = updated;
      writeUsers(users);
      const { passwordHash, ...safe } = updated;
      return json(res, 200, { user: safe });
    } catch (e) { return json(res, 400, { error: 'Dữ liệu không hợp lệ.' }); }
  }

  // --- Static Files ---
  const pathname = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '');
  const target = path.resolve(root, pathname);
  if (!target.startsWith(root) || target.startsWith(DATA_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(target, (error, file) => {
    if (error) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream' });
    res.end(file);
  });
}).listen(4173, '127.0.0.1', () => {
  console.log('TB is ready at http://127.0.0.1:4173');
});
});
