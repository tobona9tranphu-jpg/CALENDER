'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const exportsObj = factory(AppDate);
    exportsObj.QuickCapture = exportsObj;
    module.exports = exportsObj;
  } else {
    root.QuickCapture = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

  const DAY_ALIAS_MAP = {
    't2': 1, 'thu 2': 1, 'thứ 2': 1, 'thu hai': 1, 'thứ hai': 1,
    't3': 2, 'thu 3': 2, 'thứ 3': 2, 'thu ba': 2, 'thứ ba': 2,
    't4': 3, 'thu 4': 3, 'thứ 4': 3, 'thu tu': 3, 'thứ tư': 3,
    't5': 4, 'thu 5': 4, 'thứ 5': 4, 'thu nam': 4, 'thứ năm': 4,
    't6': 5, 'thu 6': 5, 'thứ 6': 5, 'thu sau': 5, 'thứ sáu': 5,
    't7': 6, 'thu 7': 6, 'thứ 7': 6, 'thu bay': 6, 'thứ bảy': 6,
    'cn': 0, 'chu nhat': 0, 'chủ nhật': 0
  };

  function parseCaptureInput(rawText = '', baseDate = null) {
    const raw = String(rawText || '').trim();
    if (!raw) {
      return {
        raw: '',
        title: '',
        cleanTitle: '',
        duration: 30,
        durationMinutes: 30,
        priority: 3,
        priorityLabel: 'Bình thường',
        targetDate: null,
        destination: 'Inbox',
        destinationLabel: 'Inbox',
        explicitDate: false,
        explicitDuration: false,
        explicitPriority: false
      };
    }

    const todayStr = baseDate
      ? (DateUtil && DateUtil.parseAppDate ? DateUtil.parseAppDate(baseDate) : baseDate)
      : (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    let work = ' ' + raw + ' ';
    let duration = 30;
    let explicitDuration = false;

    let priority = 3;
    let explicitPriority = false;

    let targetDate = null;
    let destination = 'Inbox';
    let destinationLabel = 'Inbox';
    let explicitDate = false;

    // 1. Priority extraction: !, gấp, khẩn
    if (/\s!+(\s|$)/i.test(work) || /\s(gấp|khẩn|khan|gap)\b/i.test(work)) {
      priority = 4;
      explicitPriority = true;
      work = work.replace(/\s!+(\s|$)/gi, ' ')
                 .replace(/\s(gấp|khẩn|khan|gap)\b/gi, ' ');
    }

    // 2. Duration extraction
    const durMatchHourMin = work.match(/\b(\d+)\s*(?:h|tiếng|giờ)\s*(\d+)?\s*(?:p|m|phút)?\b/i);
    const durMatchMinOnly = work.match(/\b(\d+)\s*(?:p|m|phút)\b/i);

    if (durMatchHourMin) {
      const hours = parseInt(durMatchHourMin[1], 10) || 0;
      const mins = parseInt(durMatchHourMin[2], 10) || 0;
      duration = hours * 60 + mins;
      explicitDuration = true;
      work = work.replace(durMatchHourMin[0], ' ');
    } else if (durMatchMinOnly) {
      duration = parseInt(durMatchMinOnly[1], 10) || 30;
      explicitDuration = true;
      work = work.replace(durMatchMinOnly[0], ' ');
    }

    // 3. Date extraction
    const isoMatch = work.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
      const parsedIso = DateUtil && DateUtil.parseAppDate ? DateUtil.parseAppDate(isoMatch[1]) : isoMatch[1];
      if (parsedIso) {
        targetDate = parsedIso;
        explicitDate = true;
        work = work.replace(isoMatch[0], ' ');
        if (targetDate === todayStr) {
          destination = 'Today';
          destinationLabel = 'Hôm nay';
        } else if (DateUtil && DateUtil.addAppDays && targetDate === DateUtil.addAppDays(todayStr, 1)) {
          destination = 'Tomorrow';
          destinationLabel = 'Ngày mai';
        } else {
          destination = 'Scheduled';
          destinationLabel = DateUtil && DateUtil.formatShortDate ? DateUtil.formatShortDate(targetDate) : targetDate;
        }
      }
    }

    if (!explicitDate) {
      if (/\b(hôm nay|hom nay|today)\b/i.test(work)) {
        targetDate = todayStr;
        destination = 'Today';
        destinationLabel = 'Hôm nay';
        explicitDate = true;
        work = work.replace(/\b(hôm nay|hom nay|today)\b/gi, ' ');
      } else if (/\b(ngày mai|ngay mai|mai|tomorrow)\b/i.test(work)) {
        targetDate = DateUtil && DateUtil.addAppDays ? DateUtil.addAppDays(todayStr, 1) : todayStr;
        destination = 'Tomorrow';
        destinationLabel = 'Ngày mai';
        explicitDate = true;
        work = work.replace(/\b(ngày mai|ngay mai|mai|tomorrow)\b/gi, ' ');
      } else {
        for (const [alias, targetDay] of Object.entries(DAY_ALIAS_MAP)) {
          const reg = new RegExp('\\b' + alias + '\\b', 'i');
          if (reg.test(work)) {
            const currentDay = DateUtil && DateUtil.getAppDayOfWeek ? DateUtil.getAppDayOfWeek(todayStr) : new Date().getDay();
            let delta = targetDay - currentDay;
            if (delta <= 0) delta += 7;
            targetDate = DateUtil && DateUtil.addAppDays ? DateUtil.addAppDays(todayStr, delta) : todayStr;
            destination = delta === 1 ? 'Tomorrow' : 'Scheduled';
            destinationLabel = (DateUtil && DateUtil.DAY_NAMES_VI ? DateUtil.DAY_NAMES_VI[targetDay] : alias.toUpperCase());
            explicitDate = true;
            work = work.replace(reg, ' ');
            break;
          }
        }
      }
    }

    let title = work.replace(/\s+/g, ' ').trim();
    title = title.replace(/^[\-•*○]+\s*/, '').trim();
    if (!title) {
      title = raw;
    }

    const priorityLabel = priority >= 5 ? 'Khẩn cấp' : (priority >= 4 ? 'Ưu tiên cao' : 'Bình thường');

    return {
      raw,
      title,
      cleanTitle: title,
      duration: Math.max(5, duration),
      durationMinutes: Math.max(5, duration),
      priority,
      priorityLabel,
      targetDate,
      destination,
      destinationLabel,
      explicitDate,
      explicitDuration,
      explicitPriority
    };
  }

  return {
    parseCaptureInput
  };
}));
