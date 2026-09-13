'use strict';

/**
 * @file planner-engine.js
 * Deterministic Multi-Task & Multi-Day Scheduling Engine.
 *
 * Responsibilities:
 * - Coordinated multi-task scheduling (considers all tasks together, not independently)
 * - Deadline-aware prioritization (tighter deadlines = higher urgency)
 * - Multi-day horizon distribution (spreads work across available days)
 * - Fixed event hard-constraint enforcement (never schedules over fixed events)
 * - Breathing room / buffer preservation (min 10-15 min between tasks by default)
 * - Anti-fragmentation (prefers continuous focus blocks, splits only when forced)
 * - Clean scheduling granularity (snap to :00 :15 :30 :45)
 *
 * Source label: SMART ENGINE (deterministic, not AI)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.PlannerEngine = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

  function minFromTime(t) {
    if (DateUtil && typeof DateUtil.minFromTime === 'function') return DateUtil.minFromTime(t);
    const parts = (t || '0:0').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function timeFromMin(m) {
    if (DateUtil && typeof DateUtil.timeFromMin === 'function') return DateUtil.timeFromMin(m);
    const h = String(Math.floor(m / 60) % 24).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    return h + ':' + min;
  }

  function addDays(dateStr, n) {
    if (DateUtil && typeof DateUtil.addAppDays === 'function') return DateUtil.addAppDays(dateStr, n);
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function diffDays(a, b) {
    if (DateUtil && typeof DateUtil.diffAppDays === 'function') return DateUtil.diffAppDays(a, b);
    return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  }

  function snapTo15(m, mode) {
    mode = mode || 'ceil';
    if (mode === 'floor') return Math.floor(m / 15) * 15;
    if (mode === 'round') return Math.round(m / 15) * 15;
    return Math.ceil(m / 15) * 15;
  }

  /**
   * Computes free-time slots on a given date, excluding fixed events and already-
   * scheduled actions from this planning session.
   */
  function getFreeSlots(date, context, alreadyPlaced, options) {
    alreadyPlaced = alreadyPlaced || [];
    options = options || {};
    var bufferMin = options.bufferMin !== undefined ? options.bufferMin : 10;
    var avail = context.availability || { start: '15:00', end: '21:30' };
    var availStart = minFromTime(avail.start);
    var availEnd = minFromTime(avail.end);

    // If today, do not schedule in the past
    if (date === context.currentDate && context.currentTime) {
      var nowMin = minFromTime(context.currentTime);
      if (nowMin > availStart) {
        availStart = snapTo15(nowMin, 'ceil');
      }
    }

    var occupied = [];

    (context.fixedEvents || [])
      .filter(function(e) { return e.date === date; })
      .forEach(function(e) {
        var s = minFromTime(e.start);
        var en = minFromTime(e.end);
        if (s < en) occupied.push({ start: s - bufferMin, end: en + bufferMin });
      });

    alreadyPlaced
      .filter(function(a) { return a.date === date; })
      .forEach(function(a) {
        var s = minFromTime(a.startTime);
        var en = minFromTime(a.endTime);
        if (s < en) occupied.push({ start: s - bufferMin, end: en + bufferMin });
      });

    occupied.sort(function(a, b) { return a.start - b.start; });
    var merged = [];
    for (var i = 0; i < occupied.length; i++) {
      var iv = occupied[i];
      if (merged.length === 0) { merged.push({ start: iv.start, end: iv.end }); continue; }
      var last = merged[merged.length - 1];
      if (iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
      } else {
        merged.push({ start: iv.start, end: iv.end });
      }
    }

    var free = [];
    var cursor = availStart;
    for (var j = 0; j < merged.length; j++) {
      var block = merged[j];
      var gapStart = Math.max(cursor, availStart);
      var gapEnd = Math.min(block.start, availEnd);
      if (gapEnd > gapStart) {
        free.push({ start: snapTo15(gapStart, 'ceil'), end: snapTo15(gapEnd, 'floor') });
      }
      cursor = Math.max(cursor, block.end);
    }
    var finalStart = Math.max(cursor, availStart);
    if (availEnd > finalStart) {
      free.push({ start: snapTo15(finalStart, 'ceil'), end: snapTo15(availEnd, 'floor') });
    }

    return free.filter(function(s) { return s.end - s.start >= 15; });
  }

  function totalFreeMinutes(date, context, alreadyPlaced) {
    return getFreeSlots(date, context, alreadyPlaced || [])
      .reduce(function(sum, s) { return sum + (s.end - s.start); }, 0);
  }

  function buildCapacityWarning(totalRequiredMin, deadlineDate, currentDate, context) {
    if (!deadlineDate) return null;
    var daysUntil = diffDays(deadlineDate, currentDate);
    if (daysUntil < 0) return null;

    var totalCapacity = 0;
    var alreadyPlaced = [];
    for (var i = 0; i <= daysUntil && i < 7; i++) {
      totalCapacity += totalFreeMinutes(addDays(currentDate, i), context, alreadyPlaced);
    }
    if (totalCapacity >= totalRequiredMin) return null;

    var needH = Math.floor(totalRequiredMin / 60);
    var needM = totalRequiredMin % 60;
    var haveH = Math.floor(totalCapacity / 60);
    var haveM = totalCapacity % 60;
    var needStr = needM > 0 ? (needH + ' gio ' + needM + ' phut') : (needH + ' gio');
    var haveStr = haveM > 0 ? (haveH + ' gio ' + haveM + ' phut') : (haveH + ' gio');

    var dayNames = ['Chu Nhat', 'Thu Hai', 'Thu Ba', 'Thu Tu', 'Thu Nam', 'Thu Sau', 'Thu Bay'];
    var deadlineName = deadlineDate;
    try {
      var dObj = new Date(deadlineDate + 'T00:00:00');
      deadlineName = dayNames[dObj.getDay()] || deadlineDate;
    } catch(e) {}

    return 'Khong du thoi gian. Can ' + needStr + ' truoc ' + deadlineName + ', nhung chi con ' + haveStr + ' kha dung.';
  }

  function placeTask(task, durationMin, date, context, alreadyPlaced, opts) {
    opts = opts || {};
    var bufferMin = opts.bufferMin !== undefined ? opts.bufferMin : 10;
    var minBlockMin = opts.minBlockMin !== undefined ? opts.minBlockMin : 45;
    var slots = getFreeSlots(date, context, alreadyPlaced, { bufferMin: bufferMin });

    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var slotLen = slot.end - slot.start;
      var actualDuration = Math.min(durationMin, slotLen);
      if (actualDuration < minBlockMin && durationMin >= minBlockMin) continue;
      if (actualDuration < 15) continue;

      return {
        startTime: timeFromMin(slot.start),
        endTime: timeFromMin(slot.start + actualDuration),
        durationMinutes: actualDuration
      };
    }
    return null;
  }

  /**
   * Main scheduling entry point.
   * Schedules all intent tasks across the planning horizon.
   *
   * @param {Object} intent - { tasks, fixedEvents, deadlines, ... }
   * @param {Object} context - Planning context from buildPlanningContext()
   * @param {Object} [opts]
   * @returns {{ actions, warnings, rationale, source }}
   */
  function scheduleTasks(intent, context, opts) {
    opts = opts || {};
    var horizonDays = Math.min(opts.horizonDays || context.horizonDays || 2, 7);
    var bufferMin = opts.bufferMin !== undefined ? opts.bufferMin : 10;
    var minBlockMin = opts.minBlockMin !== undefined ? opts.minBlockMin : 45;

    var currentDate = context.currentDate ||
      (DateUtil && DateUtil.getTodayAppDate ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10));

    var actions = [];
    var warnings = [];
    var rationale = [];
    var actionIndex = 0;

    function nextId(prefix) {
      actionIndex++;
      return 'action-' + (prefix || 'task') + '-' + actionIndex;
    }

    // Step 1: Fixed events from intent
    var fixedEvents = intent.fixedEvents || [];
    for (var fi = 0; fi < fixedEvents.length; fi++) {
      var fe = fixedEvents[fi];
      var feDate = fe.date || currentDate;
      var feDur = fe.durationMinutes;
      if (!feDur && fe.start && fe.end) {
        feDur = minFromTime(fe.end) - minFromTime(fe.start);
      }
      feDur = feDur || 60;
      var feEnd = fe.end || timeFromMin(minFromTime(fe.start) + feDur);

      actions.push({
        id: nextId('fe'),
        type: 'create_event',
        taskId: null,
        title: fe.title,
        date: feDate,
        startTime: fe.start,
        endTime: feEnd,
        durationMinutes: feDur
      });
      rationale.push({
        targetId: 'action-fe-' + actionIndex,
        reason: 'Su kien co dinh "' + fe.title + '" giu nguyen tai ' + fe.start + '.'
      });
    }

    // Step 2: Sort flexible tasks by urgency
    var flexTasks = (intent.tasks || []).map(function(t) {
      var urgency = 0;
      if (t.deadline) {
        var dUntil = diffDays(t.deadline, currentDate);
        urgency = dUntil <= 0 ? 1000 : Math.max(0, 100 - dUntil);
      }
      return {
        id: t.id || null,
        title: t.title,
        durationMinutes: Number(t.durationMinutes || t.minutes || 30),
        priority: Number(t.priority || 3),
        deadline: t.deadline || null,
        urgency: urgency,
        remainingMin: Number(t.durationMinutes || t.minutes || 30)
      };
    });

    flexTasks.sort(function(a, b) {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      return b.priority - a.priority;
    });

    // Capacity warnings
    for (var wi = 0; wi < flexTasks.length; wi++) {
      var wt = flexTasks[wi];
      if (wt.deadline && wt.remainingMin > 0) {
        var warn = buildCapacityWarning(wt.remainingMin, wt.deadline, currentDate, context);
        if (warn) warnings.push(warn);
      }
    }

    // Step 3: Day-by-day placement
    for (var dayIdx = 0; dayIdx < horizonDays; dayIdx++) {
      var date = addDays(currentDate, dayIdx);

      for (var ti = 0; ti < flexTasks.length; ti++) {
        var task = flexTasks[ti];
        if (task.remainingMin <= 0) continue;

        var guard = 0;
        while (task.remainingMin > 0 && guard < 10) {
          guard++;
          var placed = placeTask(task, task.remainingMin, date, context, actions, {
            bufferMin: bufferMin,
            minBlockMin: task.remainingMin < minBlockMin ? 15 : minBlockMin
          });
          if (!placed) break;

          var actionId = nextId('task');
          actions.push({
            id: actionId,
            type: 'schedule_task',
            taskId: task.id,
            title: task.title,
            date: date,
            startTime: placed.startTime,
            endTime: placed.endTime,
            durationMinutes: placed.durationMinutes
          });

          task.remainingMin -= placed.durationMinutes;

          var durH = Math.floor(placed.durationMinutes / 60);
          var durM = placed.durationMinutes % 60;
          var durStr = durH > 0
            ? (durH + 'h' + (durM > 0 ? durM + 'm' : ''))
            : (durM + 'm');

          rationale.push({
            targetId: actionId,
            reason: '"' + task.title + '" ' + durStr + ' xep vao ' + date + ' ' + placed.startTime + '-' + placed.endTime + '.'
          });

          // If remainder is very small, try it as its own tiny session
          if (task.remainingMin > 0 && task.remainingMin < minBlockMin) {
            var finalPlaced = placeTask(task, task.remainingMin, date, context, actions, {
              bufferMin: bufferMin,
              minBlockMin: 1
            });
            if (finalPlaced) {
              var finalId = nextId('task');
              actions.push({
                id: finalId,
                type: 'schedule_task',
                taskId: task.id,
                title: task.title,
                date: date,
                startTime: finalPlaced.startTime,
                endTime: finalPlaced.endTime,
                durationMinutes: finalPlaced.durationMinutes
              });
              task.remainingMin -= finalPlaced.durationMinutes;
              rationale.push({
                targetId: finalId,
                reason: 'Phan con lai "' + task.title + '" (' + finalPlaced.durationMinutes + 'm) xep vao ' + date + '.'
              });
            }
            break;
          }
        }
      }
    }

    // Report unscheduled tasks
    for (var ui = 0; ui < flexTasks.length; ui++) {
      var ut = flexTasks[ui];
      if (ut.remainingMin > 0) {
        var remH = Math.floor(ut.remainingMin / 60);
        var remM = ut.remainingMin % 60;
        var remStr = remH > 0 ? (remH + 'h ' + (remM > 0 ? remM + 'm' : '')) : (remM + 'm');
        warnings.push('Khong the xep "' + ut.title + '" - con ' + remStr + ' chua duoc len lich trong ' + horizonDays + ' ngay toi.');
      }
    }

    return { actions: actions, warnings: warnings, rationale: rationale, source: 'deterministic' };
  }

  return {
    scheduleTasks: scheduleTasks,
    getFreeSlots: getFreeSlots,
    totalFreeMinutes: totalFreeMinutes,
    buildCapacityWarning: buildCapacityWarning,
    snapTo15: snapTo15,
    _minFromTime: minFromTime,
    _timeFromMin: timeFromMin,
    _addDays: addDays,
    _diffDays: diffDays
  };
}));
