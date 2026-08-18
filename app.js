const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const STORAGE = { accounts: 'luma-demo-accounts-v2', current: 'luma-demo-current-user-v2' };
const TODAY = '2026-08-13';
const DEMO_EMAIL = 'minhanh@luma.demo';
const DEMO_PASSWORD = 'demo123';
const dayNames = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

let currentUser = null;
let activePage = 'home';
let taskFilter = 'open';
let onboardingStep = 1;
let onboardingChosenSubjects = new Set(['Toán']);
let onboardingChosenDays = new Set([1, 2, 3, 4, 5]);
let selectedTimerTask = null;
let timerSeconds = 0;
let timerTotal = 0;
let timerRunning = false;
let timerInterval = null;

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const dateFrom = (value) => new Date(`${value}T12:00:00+07:00`);
const minFromTime = (value) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
const timeFromMin = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const formatMinutes = (value) => `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`;
const formatShortDate = (value) => new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(dateFrom(value));

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
      { id: 'task-integral', subjectId: 'math', topicId: 'integral', title: 'Làm 20 bài vận dụng Tích phân', deadline: '2026-08-13', minutes: 45, priority: 5, status: 'open', createdAt: '2026-08-10' },
      { id: 'task-dp', subjectId: 'informatics', topicId: 'dp', title: 'Hoàn thiện bài Dynamic Programming', deadline: '2026-08-14', minutes: 60, priority: 4, status: 'open', createdAt: '2026-08-11' },
      { id: 'task-listening', subjectId: 'ielts', topicId: 'listening', title: 'IELTS Listening · Test 3', deadline: '2026-08-15', minutes: 40, priority: 3, status: 'open', createdAt: '2026-08-12' },
      { id: 'task-functions', subjectId: 'math', topicId: 'functions', title: 'Tóm tắt công thức hàm số', deadline: '2026-08-12', minutes: 25, priority: 2, status: 'done', createdAt: '2026-08-09' },
    ],
    fixedSchedules: [
      { id: 'fixed-school', title: 'Học trên trường', day: 4, start: '07:00', end: '11:30', type: 'school' },
      { id: 'fixed-tutoring', title: 'Học thêm Toán', day: 4, start: '17:30', end: '19:00', type: 'tutoring' },
      { id: 'fixed-club', title: 'CLB Tin học', day: 2, start: '17:00', end: '18:30', type: 'personal' },
    ],
    sessions: [
      { id: 'session-1', topicId: 'reading', minutes: 40, understanding: 4, status: 'complete', date: '2026-08-13' },
      { id: 'session-2', topicId: 'integral', minutes: 45, understanding: 4, status: 'complete', date: '2026-08-12' },
      { id: 'session-3', topicId: 'writing', minutes: 45, understanding: 4, status: 'complete', date: '2026-08-11' },
      { id: 'session-4', topicId: 'dp', minutes: 45, understanding: 2, status: 'missed', date: '2026-08-11' },
      { id: 'session-5', topicId: 'dp', minutes: 60, understanding: 0, status: 'missed', date: '2026-08-10' },
      { id: 'session-6', topicId: 'functions', minutes: 25, understanding: 5, status: 'complete', date: '2026-08-09' },
      { id: 'session-7', topicId: 'listening', minutes: 45, understanding: 4, status: 'complete', date: '2026-08-08' },
    ],
    reviewSchedules: [
      { id: 'review-integral', topicId: 'integral', due: '2026-08-13', interval: 7, status: 'scheduled' },
      { id: 'review-derivatives', topicId: 'derivatives', due: '2026-08-16', interval: 3, status: 'scheduled' },
    ],
    lastSimulation: null,
  };
}

function blankAccount({ id, email, password, name }) {
  return { id, email, password, onboarded: false, profile: { name, grade: '', goal: '', timezone: 'Asia/Ho_Chi_Minh' }, availability: { start: '15:00', end: '21:00', days: [1, 2, 3, 4, 5] }, settings: { reminders: true, coach: true }, subjects: [], tasks: [], fixedSchedules: [], sessions: [], reviewSchedules: [], lastSimulation: null };
}

function accounts() { return JSON.parse(localStorage.getItem(STORAGE.accounts) || '[]'); }
function setAccounts(value) { localStorage.setItem(STORAGE.accounts, JSON.stringify(value)); }
function ensureSeed() { if (!accounts().length) setAccounts([seedAccount()]); }
function persist() { const values = accounts(); const index = values.findIndex(account => account.id === currentUser.id); if (index >= 0) values[index] = currentUser; else values.push(currentUser); setAccounts(values); }
function getSubject(id) { return currentUser.subjects.find(subject => subject.id === id); }
function getTopic(id) { for (const subject of currentUser.subjects) { const topic = subject.topics.find(item => item.id === id); if (topic) return { ...topic, subject }; } return null; }
function getTask(id) { return currentUser.tasks.find(task => task.id === id); }

function appearance(subject) {
  const palette = { math: ['math', 'math-color', 'math-card'], info: ['info', 'info-color', 'info-card'], ielts: ['ielts', 'ielts-color', 'ielts-card'] };
  const [orb, category, card] = palette[subject.color] || ['custom', 'math-color', 'math-card'];
  return { orb, category, card, icon: subject.icon || subject.name.slice(0, 1).toUpperCase(), badge: subject.name.length > 5 ? subject.name.slice(0, 3).toUpperCase() : subject.name.toUpperCase() };
}
function subjectAverage(subject) { return subject.topics.length ? Math.round(subject.topics.reduce((sum, topic) => sum + Number(topic.mastery || 0), 0) / subject.topics.length) : 0; }
function masteryStatus(mastery) { if (mastery >= 85) return ['Mastered', 'status-mastered']; if (mastery >= 70) return ['Good', 'status-good']; if (mastery >= 45) return ['Improving', 'status-improving']; return ['Weak', 'status-weak']; }
function priorityLabel(priority) { if (priority >= 5) return ['Ưu tiên cao', 'high']; if (priority >= 4) return ['Quan trọng', 'medium']; return ['Theo kế hoạch', 'regular']; }
function deadlineText(value) { const difference = Math.round((dateFrom(value) - dateFrom(TODAY)) / 86400000); if (difference < 0) return `Quá hạn ${Math.abs(difference)} ngày`; if (difference === 0) return 'Hạn chót hôm nay'; if (difference === 1) return 'Hạn chót ngày mai'; return `Hạn chót ${formatShortDate(value)}`; }
function taskScore(task) { const topic = getTopic(task.topicId); const days = Math.round((dateFrom(task.deadline) - dateFrom(TODAY)) / 86400000); return task.priority * 30 + Math.max(0, 4 - days) * 18 + (100 - (topic?.mastery || 50)) * .45; }
function openTasks() { return currentUser.tasks.filter(task => task.status !== 'done').sort((a, b) => taskScore(b) - taskScore(a)); }
function initials() { return currentUser.profile.name.trim().slice(0, 1).toUpperCase() || 'L'; }

function createPlan() {
  const availability = currentUser.availability;
  const todayDay = 4;
  const fixed = currentUser.fixedSchedules.filter(event => Number(event.day) === todayDay).sort((a, b) => minFromTime(a.start) - minFromTime(b.start));
  const selected = openTasks().slice(0, 3);
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
  if (missed) insights.push({ title: `Bạn đã bỏ lỡ ${missed} phiên học.`, body: `Luma đang ưu tiên lại các nhiệm vụ mở trong khung giờ rảnh tiếp theo của bạn.`, source: `Dựa trên lịch sử Study Sessions`, action: 'Xem lịch', page: 'schedule' });
  const review = currentUser.reviewSchedules.filter(item => item.status === 'scheduled').sort((a, b) => a.due.localeCompare(b.due))[0];
  if (review) { const topic = getTopic(review.topicId); if (topic) insights.push({ title: dateFrom(review.due) <= dateFrom(TODAY) ? `Nên ôn lại ${topic.name} hôm nay.` : `${topic.name} cần được ôn vào ${formatShortDate(review.due)}.`, body: `Lần ôn này được tạo theo khoảng cách ${review.interval} ngày từ phiên học trước.`, source: `Dựa trên Review Schedule · ${topic.subject.name}`, action: 'Bắt đầu ôn', page: 'home', review }); }
  if (!insights.length) insights.push({ title: 'Hãy ghi phiên học đầu tiên.', body: 'Khi có dữ liệu về thời lượng, mức độ hiểu hoặc quiz, Luma sẽ chỉ hiển thị insight có căn cứ.', source: 'Chưa đủ dữ liệu để suy luận', action: 'Ghi nhanh', page: 'progress' });
  return insights.slice(0, 4);
}

function renderCalendar() {
  const days = [27, 28, 29, 30, 31, ...Array.from({ length: 31 }, (_, index) => index + 1), 1, 2, 3, 4, 5, 6];
  $('#calendarDates').innerHTML = days.slice(0, 42).map((day, index) => `<span class="${index < 5 || index > 35 ? 'muted' : ''} ${day === 13 && index > 4 ? 'today-date' : ''}">${day}</span>`).join('');
}
function renderHeader() {
  const name = escapeHTML(currentUser.profile.name);
  $('#headerDate').textContent = activePage === 'home' ? 'THỨ NĂM, 13 THÁNG 8' : ({ schedule: 'SMART SCHEDULE', subjects: 'SUBJECTS & TOPICS', progress: 'LEARNING PROGRESS', tasks: 'LEARNING TASKS', insights: 'STUDY INSIGHTS', settings: 'YOUR SPACE' }[activePage] || 'LUMA');
  const titles = { home: `Chào ${name} <span>✦</span>`, schedule: 'Kế hoạch học', subjects: 'Các môn học', progress: 'Tiến độ học', tasks: 'Nhiệm vụ', insights: 'Góc nhìn học tập', settings: 'Cài đặt' };
  $('#pageTitle').innerHTML = titles[activePage];
  $('#sidebarName').textContent = currentUser.profile.name;
  $('#sidebarGrade').textContent = currentUser.profile.grade || 'Hồ sơ học mới';
  ['#avatarInitial', '#headerInitial', '#accountModalInitial'].forEach(selector => { const el = $(selector); if (el) el.textContent = initials(); });
  $('#accountModalName').textContent = currentUser.profile.name;
  $('#accountModalEmail').textContent = currentUser.email;
}
function renderToday() {
  const tasks = openTasks(); const plan = createPlan(); const completedToday = currentUser.sessions.filter(session => session.date === TODAY && session.status === 'complete');
  const totalMinutes = plan.plan.reduce((sum, task) => sum + Number(task.minutes), 0);
  const progress = currentUser.tasks.length ? Math.round((currentUser.tasks.filter(task => task.status === 'done').length / currentUser.tasks.length) * 100) : 0;
  $('#todayDescription').innerHTML = tasks.length ? `Bạn có <strong>${formatMinutes(totalMinutes)}</strong> cho ${plan.plan.length} phiên được Luma ưu tiên hôm nay.` : 'Bạn chưa có nhiệm vụ mở. Hãy thêm một nhiệm vụ để Luma tạo lịch phù hợp.';
  $('#todayPoints').innerHTML = `<div><span class="point amber"></span><strong>${String(plan.plan.length).padStart(2, '0')}</strong><small>phiên học</small></div><div><span class="point purple"></span><strong>${String(tasks.filter(task => task.priority >= 4).length).padStart(2, '0')}</strong><small>việc quan trọng</small></div><div><span class="point green"></span><strong>${progress}%</strong><small>đã hoàn thành</small></div>`;
  const focus = plan.plan[0] || tasks[0];
  if (!focus) { $('#focusSubject').textContent = 'Kế hoạch trống'; $('#focusTitle').textContent = 'Thêm nhiệm vụ đầu tiên'; $('#focusDuration').textContent = ''; $('#nextTime').textContent = 'SẴN SÀNG'; $('#focusReason').lastChild.textContent = 'Luma sẽ giải thích lý do ưu tiên ngay khi có dữ liệu.'; $('#startStudy').disabled = true; return; }
  const subject = getSubject(focus.subjectId); const topic = getTopic(focus.topicId); const style = appearance(subject);
  $('#focusOrb').className = `subject-orb ${style.orb}`; $('#focusOrb').innerHTML = style.icon;
  $('#focusSubject').textContent = subject.name; $('#focusTitle').textContent = focus.title; $('#focusDuration').textContent = `${focus.minutes} phút`; $('#nextTime').textContent = focus.start ? `BẮT ĐẦU LÚC ${focus.start}` : 'ƯU TIÊN NGAY';
  $('#focusReason').innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-3.6 10.8c.75.58 1.1 1.2 1.1 2.2h5c0-1 .35-1.62 1.1-2.2A6 6 0 0 0 12 3ZM9.5 20h5M10 17h4"/></svg>${focus.deadline === TODAY ? 'Hạn chót hôm nay, đồng thời nằm trong khung giờ rảnh của bạn.' : `${topic?.mastery || 0}% nắm vững · được ưu tiên theo hạn chót và tiến độ.`}`;
  $('#startStudy').disabled = false; $('#startStudy').dataset.taskId = focus.id;
  const priorityRows = tasks.slice(0, 3); $('#priorityTasks').innerHTML = priorityRows.length ? priorityRows.map(taskHTML).join('') : emptyHTML('Không còn nhiệm vụ mở. Một ngày nhẹ nhàng cũng là tiến độ.');
  $('#homeTimeline').innerHTML = [...completedToday.map(session => timelineSession(session, true)), ...plan.plan.map(task => timelineTask(task))].join('') || emptyHTML('Chưa có phiên nào được lên lịch hôm nay.');
}
function taskHTML(task) {
  const subject = getSubject(task.subjectId); const style = appearance(subject || { name: 'Môn khác' }); const [label, priorityClass] = priorityLabel(task.priority); const done = task.status === 'done';
  return `<article class="task-row ${done ? 'done' : ''} ${task.priority >= 5 && !done ? 'task-highlight' : ''}" data-task-id="${task.id}"><button class="check-button ${done ? 'checked' : ''}" data-toggle-task="${task.id}" aria-label="Đổi trạng thái nhiệm vụ"></button><div class="task-category ${style.category}">${style.badge}</div><button class="task-main task-open" data-open-task="${task.id}"><h3>${escapeHTML(task.title)}</h3><p><span class="tiny-calendar">□</span>${done ? 'Đã hoàn thành' : deadlineText(task.deadline)} <i>•</i>Ước tính ${task.minutes} phút</p></button><span class="priority-label ${done ? 'regular' : priorityClass}">${done ? 'Hoàn thành' : label}</span><button class="task-arrow" data-open-task="${task.id}" aria-label="Chỉnh sửa nhiệm vụ">→</button></article>`;
}
function renderSubjectProgress() {
  $('#subjectProgress').innerHTML = currentUser.subjects.length ? currentUser.subjects.slice(0, 3).map(subject => { const style = appearance(subject); const average = subjectAverage(subject); return `<article class="subject-progress-card ${style.card}"><div class="subject-card-top"><span class="subject-orb small ${style.orb}">${style.icon}</span><span class="trend ${average >= 70 ? 'up' : 'neutral'}">${average >= 70 ? '↑ Tiến bộ' : 'Cần ưu tiên'}</span></div><h3>${escapeHTML(subject.name)}</h3><p class="subject-card-target">${escapeHTML(subject.target || `${subject.topics.length} chủ đề đang theo dõi`)}</p><div class="progress-line"><span style="width:${average}%"></span></div><strong>${average}% <small>nắm vững</small></strong></article>`; }).join('') : emptyHTML('Thêm môn học đầu tiên để bắt đầu theo dõi tiến độ.');
}
function timelineTask(task) { const subject = getSubject(task.subjectId); return `<div class="time-entry current"><time>${task.start || '—'}</time><div class="timeline-line"><span></span></div><div class="schedule-event"><p>Luma đề xuất · ${escapeHTML(subject?.name || 'Tự học')}</p><h3>${escapeHTML(task.title)}</h3><small>${task.minutes} phút</small></div></div>`; }
function timelineSession(session, complete) { const topic = getTopic(session.topicId); return `<div class="time-entry ${complete ? 'done' : ''}"><time>Đã xong</time><div class="timeline-line"><span></span></div><div class="schedule-event"><p>${complete ? 'Đã hoàn thành' : 'Đã ghi nhận'} · ${escapeHTML(topic?.subject.name || 'Tự học')}</p><h3>${escapeHTML(topic?.name || 'Phiên học')}</h3><small>${session.minutes} phút</small></div></div>`; }
function renderSchedule() {
  const { fixed, plan, capacity } = createPlan(); const all = [...fixed.map(item => ({ ...item, flexible: false, sortStart: item.start })), ...plan.map(item => ({ ...item, flexible: true, sortStart: item.start }))].sort((a, b) => a.sortStart.localeCompare(b.sortStart));
  $('#scheduleCapacity').textContent = `Còn ${formatMinutes(Math.max(0, capacity - plan.reduce((sum, task) => sum + task.minutes, 0)))} linh hoạt`;
  const applied = currentUser.lastSimulation ? `<div class="active-plan-banner"><span>✓</span><span><b>Phương án mới đang áp dụng.</b> ${escapeHTML(currentUser.lastSimulation.summary)}</span></div>` : '';
  $('#scheduleTimeline').innerHTML = applied + (all.length ? all.map(event => `<article class="day-schedule-event ${event.flexible ? 'flexible' : 'fixed'}"><time>${event.start} – ${event.end || event.endTime || timeFromMin(minFromTime(event.start) + Number(event.minutes || 0))}</time><span class="event-rail"></span><div><h3>${escapeHTML(event.title)}</h3><p>${event.flexible ? `Tự học · ${escapeHTML(getSubject(event.subjectId)?.name || '')} · ${event.minutes} phút` : `${event.type === 'school' ? 'Trường học' : event.type === 'tutoring' ? 'Học thêm' : 'Hoạt động cá nhân'} · được bảo toàn`}</p></div><span class="event-tag">${event.flexible ? 'Linh hoạt' : 'Cố định'}</span></article>`).join('') : emptyHTML('Chưa có lịch cố định hay nhiệm vụ mở.'));
  const highest = plan[0]; const topic = highest ? getTopic(highest.topicId) : null;
  $('#scheduleReasonTitle').textContent = highest ? `${highest.title} được ưu tiên trước.` : 'Hãy thêm dữ liệu để Luma sắp lịch.';
  $('#scheduleReason').textContent = highest ? `${highest.deadline === TODAY ? 'Hạn chót là hôm nay. ' : ''}${topic ? `${topic.name} đang ở mức ${topic.mastery}% nắm vững. ` : ''}Phiên này vừa khít trong khung giờ rảnh và không chạm vào lịch cố định.` : 'Luma cần ít nhất một nhiệm vụ, môn học và khung giờ rảnh để tạo một lịch có lý do.';
  $('#fixedSchedulesList').innerHTML = currentUser.fixedSchedules.length ? currentUser.fixedSchedules.map(event => `<article class="fixed-schedule-card"><button data-delete-fixed="${event.id}" aria-label="Xoá ${escapeHTML(event.title)}">×</button><p>${dayNames[event.day].toUpperCase()} · ${event.type === 'school' ? 'TRƯỜNG HỌC' : event.type === 'tutoring' ? 'HỌC THÊM' : 'CÁ NHÂN'}</p><h3>${escapeHTML(event.title)}</h3><small>${event.start} – ${event.end}</small></article>`).join('') : emptyHTML('Chưa có lịch cố định.');
}
function renderSubjects() {
  $('#subjectLibrary').innerHTML = currentUser.subjects.length ? currentUser.subjects.map(subject => { const style = appearance(subject); const average = subjectAverage(subject); return `<article class="subject-editor-card"><div class="subject-editor-summary"><span class="subject-orb ${style.orb}">${style.icon}</span><p class="eyebrow">${average}% NẮM VỮNG</p><h3>${escapeHTML(subject.name)}</h3><p>${escapeHTML(subject.target || 'Chưa đặt mục tiêu môn học')}</p></div><div class="subject-editor-content"><header><p>${subject.topics.length ? 'Chỉnh sửa từng chủ đề để Luma biết phần nào cần được ưu tiên.' : 'Thêm chủ đề đầu tiên để bắt đầu theo dõi.'}</p><button class="mini-action" data-edit-subject="${subject.id}">Chỉnh sửa môn</button></header>${subject.topics.map(topic => { const [status, statusClass] = masteryStatus(topic.mastery); return `<div class="topic-editor-row"><b>${escapeHTML(topic.name)}</b><strong>${topic.mastery}%</strong><small class="${statusClass}">● ${status}</small><button class="task-arrow" data-edit-topic="${topic.id}" data-subject-id="${subject.id}" aria-label="Chỉnh sửa ${escapeHTML(topic.name)}">→</button></div>`; }).join('')}<button class="mini-action" data-add-topic="${subject.id}">+ Thêm chủ đề</button></div></article>`; }).join('') : '<div class="empty-library">Bạn chưa có môn học. Hãy thêm môn đầu tiên để Luma có cơ sở xây lịch.</div>';
}
function renderProgress() {
  const completed = currentUser.sessions.filter(session => session.status === 'complete'); const minutes = completed.reduce((sum, session) => sum + Number(session.minutes), 0);
  $('#studyMinutes').textContent = formatMinutes(minutes); $('#studyTrend').textContent = completed.length ? `Dựa trên ${completed.length} phiên hoàn thành đã lưu` : 'Chưa có phiên hoàn thành';
  const weekdayMinutes = [1, 2, 3, 4, 5, 6, 0].map(day => { const date = new Date(`2026-08-${String(10 + (day === 0 ? 6 : day - 1)).padStart(2, '0')}T12:00:00+07:00`).toISOString().slice(0, 10); return completed.filter(session => session.date === date).reduce((sum, session) => sum + session.minutes, 0); }); const max = Math.max(...weekdayMinutes, 60);
  $('#barChart').innerHTML = weekdayMinutes.map((value, index) => `<i style="height:${Math.max(8, Math.round((value / max) * 100))}%" title="${value} phút"></i>`).join('');
  const review = currentUser.reviewSchedules.filter(item => item.status === 'scheduled').sort((a, b) => a.due.localeCompare(b.due))[0]; const topic = review ? getTopic(review.topicId) : null;
  if (topic) { $('#reviewTopic').textContent = topic.name; $('#retentionValues').innerHTML = `<span>Trước học<b>${topic.quiz?.before ?? '—'}/10</b></span><i></i><span>Sau học<b>${topic.quiz?.after ?? '—'}/10</b></span><i></i><span>Sau ${review.interval} ngày<b>${topic.quiz?.retention ?? '—'}/10</b></span>`; $('#reviewNote').innerHTML = dateFrom(review.due) <= dateFrom(TODAY) ? `Đến lịch ôn lại hôm nay. Luma đặt lần ôn này sau <strong>${review.interval} ngày</strong> vì đó là khoảng cách đã lưu từ phiên trước.` : `Lần ôn kế tiếp: <strong>${formatShortDate(review.due)}</strong>. Khoảng cách hiện tại là ${review.interval} ngày.`; } else { $('#reviewTopic').textContent = 'Chưa có lịch ôn'; $('#retentionValues').innerHTML = '<span>Hãy hoàn thành một phiên học để Luma tạo lịch ôn.</span>'; $('#reviewNote').textContent = 'Spaced repetition sẽ thay đổi khoảng cách theo mức độ hiểu bạn ghi nhận.'; }
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
  $('#settingsList').innerHTML = `<article><span class="settings-icon">◉</span><div><h3>Hồ sơ học tập</h3><p>${escapeHTML(currentUser.profile.name)} · ${escapeHTML(currentUser.profile.grade || 'Chưa chọn lớp')}</p><span class="settings-value">${escapeHTML(currentUser.profile.goal || 'Chưa đặt mục tiêu chính')}</span></div><button class="soft-button" data-settings-action="profile">Chỉnh sửa</button></article><article><span class="settings-icon">◷</span><div><h3>Khoảng thời gian tự học</h3><p>Luma chỉ xếp phiên linh hoạt vào khoảng này</p><span class="settings-value">${availability}</span></div><button class="soft-button" data-settings-action="availability">Chỉnh sửa</button></article><article><span class="settings-icon">▦</span><div><h3>Môn học và chủ đề</h3><p>${subjectCount} môn · ${currentUser.subjects.reduce((sum, subject) => sum + subject.topics.length, 0)} chủ đề đang theo dõi</p><span class="settings-value">Cấu hình Knowledge Map</span></div><button class="soft-button" data-settings-action="subjects">Quản lý</button></article><article><span class="settings-icon">♢</span><div><h3>Nhắc lịch học</h3><p>Nhắc trước mỗi phiên học 10 phút</p><span class="settings-value">${currentUser.settings.reminders ? 'Đang bật' : 'Đang tắt'}</span></div><label class="switch"><input id="reminderToggle" type="checkbox" ${currentUser.settings.reminders ? 'checked' : ''}><span></span></label></article><article><span class="settings-icon">✦</span><div><h3>Study Coach</h3><p>Hiển thị insight rút ra từ dữ liệu đã lưu</p><span class="settings-value">${currentUser.settings.coach ? 'Đang bật' : 'Đang tắt'}</span></div><label class="switch"><input id="coachToggle" type="checkbox" ${currentUser.settings.coach ? 'checked' : ''}><span></span></label></article>`;
}
function emptyHTML(message) { return `<div class="empty-state">${escapeHTML(message)}</div>`; }
function renderApp() { if (!currentUser) return; renderHeader(); renderCalendar(); renderToday(); renderSubjectProgress(); renderSchedule(); renderSubjects(); renderProgress(); renderTasks(); renderInsights(); renderSettings(); }

function showPage(page) { activePage = page; $$('.page').forEach(item => item.classList.toggle('active-page', item.id === page)); $$('.nav-link').forEach(item => item.classList.toggle('active', item.dataset.page === page)); renderHeader(); if (window.innerWidth <= 600) $('.sidebar').classList.remove('mobile-open'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function openModal(id) { const modal = $(`#${id}`); if (!modal) return; modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { const modal = $(`#${id}`); if (!modal) return; modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); if (!$$('.modal-backdrop.open').length) document.body.style.overflow = ''; }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(element.timer); element.timer = setTimeout(() => element.classList.remove('show'), 3000); }

function openStudy(taskId) { const task = getTask(taskId) || openTasks()[0]; if (!task) { toast('Hãy thêm một nhiệm vụ trước khi bắt đầu phiên học.'); showPage('tasks'); return; } selectedTimerTask = task; timerTotal = Number(task.minutes) * 60; timerSeconds = timerTotal; const subject = getSubject(task.subjectId); const style = appearance(subject); $('#timerOrb').className = `subject-orb ${style.orb} large`; $('#timerOrb').innerHTML = style.icon; $('#timerMeta').textContent = `${subject?.name || 'Tự học'} · ${task.minutes} PHÚT`; $('#studyTitle').textContent = task.title; $('#timerNote').textContent = 'Khi hoàn thành, Luma sẽ lưu phiên học và tạo mốc ôn lại dựa trên mức độ hiểu của bạn.'; updateTimer(); $('#pauseTimer').textContent = 'Tạm dừng'; openModal('studyModal'); if (!timerRunning) toggleTimer(); }
function updateTimer() { $('#timerDisplay').textContent = `${String(Math.floor(timerSeconds / 60)).padStart(2, '0')}:${String(timerSeconds % 60).padStart(2, '0')}`; $('#timerProgress').style.width = `${Math.min(100, ((timerTotal - timerSeconds) / timerTotal) * 100)}%`; }
function toggleTimer() { timerRunning = !timerRunning; $('#pauseTimer').textContent = timerRunning ? 'Tạm dừng' : 'Tiếp tục'; if (timerRunning) { timerInterval = setInterval(() => { if (timerSeconds > 0) { timerSeconds -= 1; updateTimer(); } else { toggleTimer(); toast('Đã hết thời gian cho phiên này.'); } }, 1000); } else clearInterval(timerInterval); }
function saveSession({ topicId, minutes, understanding, taskId = null }) { currentUser.sessions.push({ id: uid('session'), topicId, minutes: Number(minutes), understanding: Number(understanding), status: 'complete', date: TODAY, taskId }); const entry = getTopic(topicId); if (entry) { entry.mastery = Math.min(100, Math.round(entry.mastery + Math.max(1, Number(understanding) - 1))); const interval = Number(understanding) <= 2 ? 1 : Number(understanding) === 3 ? 3 : Number(understanding) === 4 ? 7 : 14; currentUser.reviewSchedules = currentUser.reviewSchedules.filter(review => review.topicId !== topicId || review.status !== 'scheduled'); const due = new Date(`${TODAY}T12:00:00+07:00`); due.setDate(due.getDate() + interval); currentUser.reviewSchedules.push({ id: uid('review'), topicId, due: due.toISOString().slice(0, 10), interval, status: 'scheduled' }); }
  persist(); renderApp(); }
function completeTimer() { if (!selectedTimerTask) return; if (timerRunning) toggleTimer(); saveSession({ topicId: selectedTimerTask.topicId, minutes: selectedTimerTask.minutes, understanding: 4, taskId: selectedTimerTask.id }); closeModal('studyModal'); toast('Đã lưu phiên học và tạo mốc ôn lại mới.'); }
function toggleTask(taskId) { const task = getTask(taskId); if (!task) return; task.status = task.status === 'done' ? 'open' : 'done'; persist(); renderApp(); toast(task.status === 'done' ? 'Đã cập nhật nhiệm vụ hoàn thành.' : 'Nhiệm vụ đã được mở lại.'); }

function populateTaskFields(subjectId, topicId) { const select = $('#taskSubject'); select.innerHTML = currentUser.subjects.map(subject => `<option value="${subject.id}">${escapeHTML(subject.name)}</option>`).join(''); if (subjectId) select.value = subjectId; const subject = getSubject(select.value); $('#taskTopic').innerHTML = subject?.topics.length ? subject.topics.map(topic => `<option value="${topic.id}">${escapeHTML(topic.name)}</option>`).join('') : '<option value="">Chưa có chủ đề</option>'; if (topicId) $('#taskTopic').value = topicId; }
function openTaskModal(task = null) { if (!currentUser.subjects.length) { toast('Hãy thêm ít nhất một môn học trước khi tạo nhiệm vụ.'); showPage('subjects'); return; } $('#taskModalTitle').textContent = task ? 'Chỉnh sửa nhiệm vụ' : 'Thêm nhiệm vụ mới'; $('#taskId').value = task?.id || ''; $('#taskName').value = task?.title || ''; populateTaskFields(task?.subjectId, task?.topicId); $('#taskDuration').value = String(task?.minutes || 45); $('#taskPriority').value = String(task?.priority || 4); $('#taskDeadline').value = task?.deadline || TODAY; $('#deleteTaskButton').hidden = !task; openModal('taskModal'); }
function saveTask(event) { event.preventDefault(); const id = $('#taskId').value; const title = $('#taskName').value.trim(); const subjectId = $('#taskSubject').value; const topicId = $('#taskTopic').value; if (!title || !subjectId || !topicId) { toast('Hãy chọn môn học và chủ đề cho nhiệm vụ.'); return; } const task = { id: id || uid('task'), subjectId, topicId, title, minutes: Number($('#taskDuration').value), priority: Number($('#taskPriority').value), deadline: $('#taskDeadline').value || TODAY, status: id ? getTask(id).status : 'open', createdAt: id ? getTask(id).createdAt : TODAY }; const index = currentUser.tasks.findIndex(item => item.id === id); if (index >= 0) currentUser.tasks[index] = task; else currentUser.tasks.unshift(task); persist(); renderApp(); closeModal('taskModal'); toast(id ? 'Đã lưu thay đổi nhiệm vụ.' : 'Đã thêm nhiệm vụ và cập nhật lịch thông minh.'); }
function deleteTask() { const id = $('#taskId').value; if (!id) return; currentUser.tasks = currentUser.tasks.filter(task => task.id !== id); persist(); renderApp(); closeModal('taskModal'); toast('Đã xoá nhiệm vụ.'); }

function openSubjectModal(subject = null) { $('#subjectModalTitle').textContent = subject ? 'Chỉnh sửa môn học' : 'Thêm môn học'; $('#subjectId').value = subject?.id || ''; $('#subjectName').value = subject?.name || ''; $('#subjectTarget').value = subject?.target || ''; $('#subjectFirstTopic').value = ''; $('#subjectFirstTopic').parentElement.hidden = Boolean(subject); $('#deleteSubjectButton').hidden = !subject; openModal('subjectModal'); }
function saveSubject(event) { event.preventDefault(); const id = $('#subjectId').value; const name = $('#subjectName').value.trim(); if (!name) return; if (id) { const subject = getSubject(id); subject.name = name; subject.target = $('#subjectTarget').value.trim(); } else { const color = ['math', 'info', 'ielts', 'custom'][currentUser.subjects.length % 4]; const firstTopic = $('#subjectFirstTopic').value.trim(); currentUser.subjects.push({ id: uid('subject'), name, target: $('#subjectTarget').value.trim(), color, icon: color === 'math' ? '∫' : color === 'info' ? '&lt;/&gt;' : color === 'ielts' ? 'A' : name.slice(0, 1).toUpperCase(), topics: firstTopic ? [{ id: uid('topic'), name: firstTopic, mastery: 50, quiz: {} }] : [] }); } persist(); renderApp(); closeModal('subjectModal'); toast(id ? 'Đã lưu môn học.' : 'Đã thêm môn học.'); }
function deleteSubject() { const id = $('#subjectId').value; if (!id) return; const topicIds = getSubject(id).topics.map(topic => topic.id); currentUser.subjects = currentUser.subjects.filter(subject => subject.id !== id); currentUser.tasks = currentUser.tasks.filter(task => task.subjectId !== id); currentUser.sessions = currentUser.sessions.filter(session => !topicIds.includes(session.topicId)); currentUser.reviewSchedules = currentUser.reviewSchedules.filter(review => !topicIds.includes(review.topicId)); persist(); renderApp(); closeModal('subjectModal'); toast('Đã xoá môn học và dữ liệu liên quan.'); }
function openTopicModal(subjectId, topic = null) { $('#topicModalTitle').textContent = topic ? 'Chỉnh sửa chủ đề' : 'Thêm chủ đề'; $('#topicSubjectId').value = subjectId; $('#topicId').value = topic?.id || ''; $('#topicName').value = topic?.name || ''; $('#topicMastery').value = topic?.mastery || 50; $('#topicMasteryOutput').textContent = `${topic?.mastery || 50}%`; $('#deleteTopicButton').hidden = !topic; openModal('topicModal'); }
function saveTopic(event) { event.preventDefault(); const subject = getSubject($('#topicSubjectId').value); const id = $('#topicId').value; const name = $('#topicName').value.trim(); if (!subject || !name) return; const entry = { id: id || uid('topic'), name, mastery: Number($('#topicMastery').value), quiz: id ? getTopic(id).quiz || {} : {} }; const index = subject.topics.findIndex(topic => topic.id === id); if (index >= 0) subject.topics[index] = entry; else subject.topics.push(entry); persist(); renderApp(); closeModal('topicModal'); toast(id ? 'Đã cập nhật chủ đề.' : 'Đã thêm chủ đề.'); }
function deleteTopic() { const subject = getSubject($('#topicSubjectId').value); const id = $('#topicId').value; if (!subject || !id) return; subject.topics = subject.topics.filter(topic => topic.id !== id); currentUser.tasks = currentUser.tasks.filter(task => task.topicId !== id); currentUser.sessions = currentUser.sessions.filter(session => session.topicId !== id); currentUser.reviewSchedules = currentUser.reviewSchedules.filter(review => review.topicId !== id); persist(); renderApp(); closeModal('topicModal'); toast('Đã xoá chủ đề và lịch ôn liên quan.'); }

function openFixedModal() { $('#fixedForm').reset(); $('#fixedStart').value = '18:00'; $('#fixedEnd').value = '19:30'; openModal('fixedModal'); }
function saveFixed(event) { event.preventDefault(); const start = $('#fixedStart').value; const end = $('#fixedEnd').value; if (minFromTime(end) <= minFromTime(start)) { toast('Giờ kết thúc cần sau giờ bắt đầu.'); return; } currentUser.fixedSchedules.push({ id: uid('fixed'), title: $('#fixedTitle').value.trim(), day: Number($('#fixedDay').value), type: $('#fixedType').value, start, end }); persist(); renderApp(); closeModal('fixedModal'); toast('Đã thêm lịch cố định. Luma sẽ không xếp phiên học chồng lên lịch này.'); }
function deleteFixed(id) { currentUser.fixedSchedules = currentUser.fixedSchedules.filter(event => event.id !== id); persist(); renderApp(); toast('Đã xoá lịch cố định.'); }
function openAvailability() { $('#availabilityStart').value = currentUser.availability.start; $('#availabilityEnd').value = currentUser.availability.end; $$('#availabilityDays button').forEach(button => button.classList.toggle('chosen', currentUser.availability.days.includes(Number(button.dataset.day)))); openModal('availabilityModal'); }
function saveAvailability(event) { event.preventDefault(); const days = $$('#availabilityDays button.chosen').map(button => Number(button.dataset.day)); if (!days.length || minFromTime($('#availabilityEnd').value) <= minFromTime($('#availabilityStart').value)) { toast('Hãy chọn ít nhất một ngày và khung giờ hợp lệ.'); return; } currentUser.availability = { start: $('#availabilityStart').value, end: $('#availabilityEnd').value, days }; persist(); renderApp(); closeModal('availabilityModal'); toast('Đã lưu khung giờ rảnh và sắp lại các phiên linh hoạt.'); }
function openProfile() { $('#profileName').value = currentUser.profile.name; $('#profileGrade').value = currentUser.profile.grade; $('#profileGoal').value = currentUser.profile.goal; $('#profileTimezone').value = currentUser.profile.timezone; openModal('profileModal'); }
function saveProfile(event) { event.preventDefault(); Object.assign(currentUser.profile, { name: $('#profileName').value.trim(), grade: $('#profileGrade').value.trim(), goal: $('#profileGoal').value.trim(), timezone: $('#profileTimezone').value }); persist(); renderApp(); closeModal('profileModal'); toast('Đã lưu hồ sơ học tập.'); }
function openQuickLog() { const topics = currentUser.subjects.flatMap(subject => subject.topics.map(topic => ({ ...topic, subject }))); if (!topics.length) { toast('Hãy thêm chủ đề trước khi ghi phiên học.'); showPage('subjects'); return; } $('#logTopic').innerHTML = topics.map(topic => `<option value="${topic.id}">${escapeHTML(topic.subject.name)} · ${escapeHTML(topic.name)}</option>`).join(''); openModal('quickLogModal'); }
function saveQuickLog(event) { event.preventDefault(); saveSession({ topicId: $('#logTopic').value, minutes: $('#logMinutes').value, understanding: $('#logUnderstanding').value }); closeModal('quickLogModal'); toast('Đã lưu phiên học và cập nhật lịch ôn.'); }

function calculateRisk(extraTests = 0) { const workload = openTasks().reduce((sum, task) => sum + task.minutes, 0) + extraTests * 90; const days = Math.max(1, currentUser.availability.days.length); const weeklyCapacity = (minFromTime(currentUser.availability.end) - minFromTime(currentUser.availability.start)) * days; const missed = currentUser.sessions.filter(session => session.status === 'missed').length; return Math.max(5, Math.min(88, Math.round(6 + (workload / Math.max(1, weeklyCapacity)) * 66 + Math.min(12, missed * 3)))); }
function runSimulation() { const text = $('#whatIfInput').value.trim(); if (!text) { toast('Hãy mô tả một thay đổi để Luma mô phỏng.'); return; } const number = Number((text.match(/\d+/) || ['1'])[0]); const currentRisk = calculateRisk(number); const newRisk = Math.max(5, Math.round(currentRisk * .42)); const first = openTasks()[0]; const plan = first ? `Đưa “${first.title}” vào phiên sớm nhất, sau đó tách ${number > 1 ? `${number} phiên` : '1 phiên'} ôn ngắn 45 phút trong khung giờ rảnh.` : 'Tạo các phiên ôn ngắn trong khung giờ rảnh bạn đã chọn.'; $('#simulationResult').hidden = false; $('#simulationResult').innerHTML = `<div class="risk-comparison"><div><p>Lịch hiện tại</p><strong>${currentRisk}<small>%</small></strong><span>nguy cơ trễ</span></div><div class="risk-arrow">→</div><div class="improved"><p>Phương án mới</p><strong>${newRisk}<small>%</small></strong><span>nguy cơ trễ</span></div></div><p class="plan-summary"><b>Đề xuất:</b> ${escapeHTML(plan)} Lịch cố định vẫn được giữ nguyên.</p><button class="apply-plan" id="applyPlan">Áp dụng phương án mới</button>`; $('#runSimulation').disabled = true; $('#runSimulation').innerHTML = 'Đã tạo phương án <span>✓</span>'; }
function applySimulation() { const text = $('#whatIfInput').value.trim(); const number = Number((text.match(/\d+/) || ['1'])[0]); const oldRisk = calculateRisk(number); currentUser.lastSimulation = { summary: `Ưu tiên thêm ${number} phiên ôn ngắn, nguy cơ trễ giảm từ ${oldRisk}% xuống ${Math.max(5, Math.round(oldRisk * .42))}%.`, appliedAt: TODAY }; persist(); renderApp(); closeModal('whatIfModal'); showPage('schedule'); toast('Đã áp dụng phương án mới vào lịch linh hoạt.'); }

function signIn(email, password) { const account = accounts().find(item => item.email.toLowerCase() === email.trim().toLowerCase() && item.password === password); if (!account) { $('#loginError').textContent = 'Email hoặc mật khẩu chưa đúng. Bạn có thể dùng tài khoản mẫu bên dưới.'; $('#loginError').hidden = false; return; } currentUser = clone(account); localStorage.setItem(STORAGE.current, account.id); $('#authView').hidden = true; $('#appShell').hidden = false; activePage = 'home'; renderApp(); if (!currentUser.onboarded) { resetOnboarding(); openModal('onboardingModal'); } }
function logout() { if (timerRunning) toggleTimer(); localStorage.removeItem(STORAGE.current); currentUser = null; $('#appShell').hidden = true; $('#authView').hidden = false; $$('.modal-backdrop.open').forEach(modal => closeModal(modal.id)); $('#loginPassword').value = ''; toast('Đã đăng xuất khỏi hồ sơ demo.'); }
function resetOnboarding() { onboardingStep = 1; onboardingChosenSubjects = new Set(['Toán']); onboardingChosenDays = new Set([1, 2, 3, 4, 5]); $$('.onboarding-step').forEach(step => step.classList.toggle('active', Number(step.dataset.onboardingStep) === 1)); $$('.onboarding-dots i').forEach((dot, index) => dot.classList.toggle('active', index === 0)); $('#onboardingNext').innerHTML = 'Tiếp tục <span>→</span>'; $$('#onboardingSubjects button').forEach(button => button.classList.toggle('chosen', onboardingChosenSubjects.has(button.dataset.subjectChoice))); $$('#onboardingDays button').forEach(button => button.classList.toggle('chosen', onboardingChosenDays.has(Number(button.dataset.day)))); }
function advanceOnboarding() { if (onboardingStep < 4) { onboardingStep += 1; $$('.onboarding-step').forEach(step => step.classList.toggle('active', Number(step.dataset.onboardingStep) === onboardingStep)); $$('.onboarding-dots i').forEach((dot, index) => dot.classList.toggle('active', index < onboardingStep)); $('#onboardingNext').innerHTML = onboardingStep === 4 ? 'Tạo kế hoạch đầu tiên <span>✦</span>' : 'Tiếp tục <span>→</span>'; return; } currentUser.profile.grade = $('#onboardingGrade').value.trim(); currentUser.profile.goal = $('#onboardingGoal').value.trim(); currentUser.availability = { start: $('#onboardingStart').value, end: $('#onboardingEnd').value, days: [...onboardingChosenDays] }; const colors = { 'Toán': ['math', '∫'], 'Tin học': ['info', '&lt;/&gt;'], IELTS: ['ielts', 'A'] }; currentUser.subjects = [...onboardingChosenSubjects].map(name => ({ id: uid('subject'), name, target: '', color: colors[name][0], icon: colors[name][1], topics: [{ id: uid('topic'), name: name === 'Toán' ? 'Chủ đề đầu tiên' : name === 'Tin học' ? 'Thuật toán cơ bản' : 'Reading', mastery: 50, quiz: {} }] })); currentUser.onboarded = true; persist(); renderApp(); closeModal('onboardingModal'); toast('Kế hoạch đầu tiên đã sẵn sàng. Hãy thêm nhiệm vụ để Luma ưu tiên lịch.'); }
function createProfile(event) { event.preventDefault(); const email = $('#createEmail').value.trim().toLowerCase(); if (accounts().some(account => account.email.toLowerCase() === email)) { toast('Email demo này đã tồn tại. Hãy đăng nhập hoặc dùng email khác.'); return; } const account = blankAccount({ id: uid('user'), email, password: $('#createPassword').value, name: $('#createName').value.trim() }); const values = accounts(); values.push(account); setAccounts(values); closeModal('loginProfileModal'); signIn(email, account.password); }
function exportData() { const blob = new Blob([JSON.stringify(currentUser, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `luma-${currentUser.profile.name.toLowerCase().replace(/\s+/g, '-')}.json`; link.click(); URL.revokeObjectURL(url); toast('Đã xuất bản sao lưu dữ liệu.'); }
function resetDemo() { if (!window.confirm('Khôi phục dữ liệu mẫu? Các thay đổi của tài khoản hiện tại sẽ bị thay thế.')) return; const replacement = seedAccount(); replacement.id = currentUser.id; replacement.email = currentUser.email; replacement.password = currentUser.password; currentUser = replacement; persist(); renderApp(); toast('Đã khôi phục dữ liệu mẫu cho tài khoản này.'); }
function toggleNotification() { let popover = $('#notificationPopover'); if (!popover) { popover = document.createElement('aside'); popover.id = 'notificationPopover'; popover.className = 'notification-popover'; document.body.append(popover); } const review = currentUser.reviewSchedules.filter(item => item.status === 'scheduled' && item.due <= TODAY)[0]; const topic = review && getTopic(review.topicId); popover.innerHTML = `<h3>Nhắc học hôm nay</h3><p><b>${topic ? `Ôn lại ${escapeHTML(topic.name)}` : 'Kiểm tra lịch học'}</b><br>${topic ? 'Đúng lịch spaced repetition đã lưu.' : 'Luma sẽ nhắc khi có phiên hoặc lịch ôn mới.'}</p><p><b>${openTasks().length} nhiệm vụ đang mở</b><br>Phiên quan trọng nhất đã được đưa lên đầu lịch.</p>`; popover.classList.toggle('open'); }

ensureSeed();
const remembered = localStorage.getItem(STORAGE.current); if (remembered) { const account = accounts().find(item => item.id === remembered); if (account) signIn(account.email, account.password); }

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
$('#fixedScheduleButton').addEventListener('click', openFixedModal); $('#fixedScheduleButtonSecondary').addEventListener('click', openFixedModal); $('#availabilityButton').addEventListener('click', openAvailability); $('#addSubjectButton').addEventListener('click', () => openSubjectModal()); $('#addTaskButton').addEventListener('click', () => openTaskModal()); $('#logSessionButton').addEventListener('click', openQuickLog); $('#refreshInsights').addEventListener('click', () => { renderInsights(); toast('Đã cập nhật insight từ dữ liệu hiện có.'); }); $('#exportData').addEventListener('click', exportData); $('#resetDemo').addEventListener('click', resetDemo); $('#notificationButton').addEventListener('click', toggleNotification);
$('#accountButton').addEventListener('click', () => openModal('accountModal')); $('#profileShortcut').addEventListener('click', () => openModal('accountModal')); $('#logoutButton').addEventListener('click', logout); $('#openProfileFromAccount').addEventListener('click', () => { closeModal('accountModal'); openProfile(); });

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
  const settingsAction = event.target.closest('[data-settings-action]'); if (settingsAction) { if (settingsAction.dataset.settingsAction === 'profile') openProfile(); if (settingsAction.dataset.settingsAction === 'availability') openAvailability(); if (settingsAction.dataset.settingsAction === 'subjects') showPage('subjects'); }
  if (event.target.closest('#applyPlan')) applySimulation(); if (event.target.closest('#dismissCoach')) { currentUser.settings.coach = false; persist(); renderSettings(); $('#coachCard').style.display = 'none'; toast('Đã ẩn Study Coach. Bạn có thể bật lại trong Settings.'); }
  if (event.target.closest('[data-close-modal]')) closeModal(event.target.closest('[data-close-modal]').dataset.closeModal);
  const filter = event.target.closest('[data-filter]'); if (filter) { taskFilter = filter.dataset.filter; renderTasks(); }
  const subjectChoice = event.target.closest('[data-subject-choice]'); if (subjectChoice) { const name = subjectChoice.dataset.subjectChoice; onboardingChosenSubjects.has(name) ? onboardingChosenSubjects.delete(name) : onboardingChosenSubjects.add(name); subjectChoice.classList.toggle('chosen', onboardingChosenSubjects.has(name)); }
  const dayChoice = event.target.closest('.day-picker button[data-day]'); if (dayChoice) { const collection = dayChoice.closest('#onboardingDays') ? onboardingChosenDays : null; if (collection) { const day = Number(dayChoice.dataset.day); collection.has(day) ? collection.delete(day) : collection.add(day); dayChoice.classList.toggle('chosen', collection.has(day)); } else if (dayChoice.closest('#availabilityDays')) dayChoice.classList.toggle('chosen'); }
  if (!event.target.closest('#notificationButton, #notificationPopover')) $('#notificationPopover')?.classList.remove('open');
});
document.addEventListener('change', event => { if (event.target.id === 'reminderToggle') { currentUser.settings.reminders = event.target.checked; persist(); renderSettings(); } if (event.target.id === 'coachToggle') { currentUser.settings.coach = event.target.checked; persist(); renderInsights(); renderSettings(); } });
$$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $$('.modal-backdrop.open').forEach(modal => closeModal(modal.id)); $('#notificationPopover')?.classList.remove('open'); } });
