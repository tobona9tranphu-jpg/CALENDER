(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleUtils = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function minutes(value) {
    const match = String(value || '').match(/(?:T|\s)?(\d{2}):(\d{2})/);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function overlaps(first, second) {
    return minutes(first.start) < minutes(second.end)
      && minutes(second.start) < minutes(first.end);
  }

  function dateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function addDays(date, offset) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + offset);
    return copy;
  }

  function generateWeeklyPlan(input) {
    const availability = input.availability || {};
    const days = Array.isArray(availability.days) ? availability.days.map(Number) : [];
    const start = minutes(availability.start || '15:00');
    const end = minutes(availability.end || '21:00');
    const rangeStart = input.rangeStart || dateKey(new Date());
    const rangeDays = Math.max(1, Math.min(31, Number(input.rangeDays) || 7));
    const fixedSchedules = Array.isArray(input.fixedSchedules) ? input.fixedSchedules : [];
    const tasks = Array.isArray(input.openTasks) ? input.openTasks.filter(task => task && task.status !== 'done') : [];
    const exams = Array.isArray(input.examMilestones) ? input.examMilestones : [];
    const examDistance = task => exams.reduce((best, exam) => {
      if (!exam.exam_date && !exam.date) return best;
      const distance = Math.abs(new Date(exam.exam_date || exam.date) - new Date(task.deadline || rangeStart));
      return Math.min(best, distance);
    }, Number.POSITIVE_INFINITY);
    const orderedTasks = [...tasks].sort((a, b) => {
      const priority = Number(b.priority || 0) - Number(a.priority || 0);
      const deadline = String(a.deadline || '').localeCompare(String(b.deadline || ''));
      const exam = examDistance(a) - examDistance(b);
      return priority || deadline || exam;
    });
    const result = { days: [], unscheduled: [] };
    const scheduled = new Set();
    const startDate = new Date(`${rangeStart}T12:00:00`);
    for (let offset = 0; offset < rangeDays; offset += 1) {
      const date = addDays(startDate, offset);
      const key = dateKey(date);
      const weekday = date.getDay();
      const sessions = [];
      const busy = fixedSchedules
        .filter(item => Number(item.day) === weekday)
        .map(item => ({ start: item.start, end: item.end }));
      let cursor = start;
      for (const task of orderedTasks) {
        if (scheduled.has(task.id) || !days.includes(weekday)) continue;
        const duration = Math.max(1, Number(task.minutes) || 45);
        const gaps = [...busy, ...sessions].sort((a, b) => minutes(a.start) - minutes(b.start));
        let candidate = cursor;
        for (const slot of gaps) {
          const slotStart = minutes(slot.start);
          const slotEnd = minutes(slot.end);
          if (candidate + duration <= slotStart) break;
          if (candidate < slotEnd) candidate = slotEnd + 10;
        }
        if (candidate + duration <= end) {
          sessions.push({
            taskId: task.id,
            title: task.title,
            subjectId: task.subjectId,
            topicId: task.topicId,
            minutes: duration,
            date: key,
            start: `${key}T${String(Math.floor(candidate / 60)).padStart(2, '0')}:${String(candidate % 60).padStart(2, '0')}`,
            end: `${key}T${String(Math.floor((candidate + duration) / 60)).padStart(2, '0')}:${String((candidate + duration) % 60).padStart(2, '0')}`,
          });
          scheduled.add(task.id);
          cursor = candidate + duration + 10;
        }
      }
      result.days.push({ date: key, sessions });
    }
    for (const task of orderedTasks) {
      if (!scheduled.has(task.id)) result.unscheduled.push({ taskId: task.id, title: task.title, reason: 'Không đủ thời gian trong khung giờ rảnh đã chọn.' });
    }
    return result;
  }

  return { minutes, overlaps, generateWeeklyPlan };
}));
