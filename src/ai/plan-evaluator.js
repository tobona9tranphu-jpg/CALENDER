'use strict';

/**
 * @file plan-evaluator.js
 * Deterministic Plan Quality Evaluator.
 *
 * Evaluates a PlanningProposal against the planning context and returns
 * a structured quality report:
 *   { score, strengths, warnings, metrics }
 *
 * Score: 0-100
 * - Conflict freedom:      +30 pts
 * - Deadline compliance:   +25 pts
 * - Availability window:   +15 pts
 * - Workload balance:      +15 pts
 * - Buffer preservation:   +10 pts
 * - Anti-fragmentation:    + 5 pts
 *
 * Pure deterministic — never calls any AI service.
 * Source label: SMART ENGINE
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    module.exports = factory(AppDate);
  } else {
    root.PlanEvaluator = factory(root.AppDate);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DateUtil) {

  function minFromTime(t) {
    if (DateUtil && typeof DateUtil.minFromTime === 'function') return DateUtil.minFromTime(t);
    var parts = (t || '0:0').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function diffDays(a, b) {
    if (DateUtil && typeof DateUtil.diffAppDays === 'function') return DateUtil.diffAppDays(a, b);
    return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  }

  /**
   * Evaluates a planning proposal against the context.
   *
   * @param {Object} proposal - PlanningProposal
   * @param {Object} context  - PlanningContext
   * @returns {{ score: number, strengths: string[], warnings: string[], metrics: Object }}
   */
  function evaluatePlanQuality(proposal, context) {
    if (!proposal || !Array.isArray(proposal.actions)) {
      return {
        score: 0,
        strengths: [],
        warnings: ['Ke hoach khong hop le hoac trong.'],
        metrics: {
          totalScheduledMinutes: 0,
          freeMinutesRemaining: 0,
          focusBlocksCount: 0,
          fragmentationRate: 0,
          daysCovered: 0,
          conflictsCount: 0
        }
      };
    }

    context = context || {};
    var avail = context.availability || { start: '06:00', end: '23:59' };
    var availStartMin = minFromTime(avail.start);
    var availEndMin = minFromTime(avail.end);
    var currentDate = context.currentDate || new Date().toISOString().slice(0, 10);

    var actions = proposal.actions;
    var fixedEvents = context.fixedEvents || [];

    var strengths = [];
    var warnings = [];

    // ── Metric 1: Conflict detection ─────────────────────────────────────────
    var conflictsCount = 0;
    for (var i = 0; i < actions.length; i++) {
      var act = actions[i];
      var actStart = minFromTime(act.startTime);
      var actEnd = minFromTime(act.endTime);

      // Check against fixed events on same date
      for (var j = 0; j < fixedEvents.length; j++) {
        var fe = fixedEvents[j];
        if (fe.date !== act.date) continue;
        var feStart = minFromTime(fe.start);
        var feEnd = minFromTime(fe.end);
        if (actStart < feEnd && actEnd > feStart) {
          conflictsCount++;
        }
      }

      // Check against other actions in the proposal on same date
      for (var k = i + 1; k < actions.length; k++) {
        var other = actions[k];
        if (other.date !== act.date) continue;
        var oStart = minFromTime(other.startTime);
        var oEnd = minFromTime(other.endTime);
        if (actStart < oEnd && actEnd > oStart) {
          conflictsCount++;
        }
      }
    }

    var conflictScore = conflictsCount === 0 ? 30 : Math.max(0, 30 - conflictsCount * 10);
    if (conflictsCount === 0) {
      strengths.push('Khong co xung dot voi lich hoc co dinh');
    } else {
      warnings.push('Co ' + conflictsCount + ' xung dot thoi gian trong ke hoach');
    }

    // ── Metric 2: Total scheduled minutes and days covered ────────────────────
    var totalScheduledMinutes = 0;
    var daySet = {};
    var taskActions = actions.filter(function(a) { return a.type === 'schedule_task'; });
    for (var si = 0; si < taskActions.length; si++) {
      totalScheduledMinutes += Number(taskActions[si].durationMinutes || 0);
      daySet[taskActions[si].date] = true;
    }
    var daysCovered = Object.keys(daySet).length;

    // ── Metric 3: Deadline compliance ─────────────────────────────────────────
    var deadlines = context.deadlines || [];
    var deadlineScore = 25;
    var deadlinesKept = 0;
    var deadlinesMissed = 0;

    // Group scheduled minutes by task title approximation
    var scheduledByTitle = {};
    for (var di = 0; di < taskActions.length; di++) {
      var a = taskActions[di];
      var titleKey = (a.title || '').toLowerCase().trim();
      scheduledByTitle[titleKey] = (scheduledByTitle[titleKey] || 0) + (a.durationMinutes || 0);
    }

    if (deadlines.length > 0) {
      for (var dli = 0; dli < deadlines.length; dli++) {
        var dl = deadlines[dli];
        var lastActionDate = null;
        for (var lai = 0; lai < taskActions.length; lai++) {
          if (taskActions[lai].title && dl.title &&
              taskActions[lai].title.toLowerCase().indexOf(dl.title.toLowerCase()) >= 0) {
            if (!lastActionDate || taskActions[lai].date > lastActionDate) {
              lastActionDate = taskActions[lai].date;
            }
          }
        }
        if (lastActionDate && dl.date && lastActionDate <= dl.date) {
          deadlinesKept++;
        } else if (dl.date) {
          deadlinesMissed++;
        }
      }
      if (deadlinesMissed === 0 && deadlinesKept > 0) {
        deadlineScore = 25;
        strengths.push('100% nhiem vu hoan thanh truoc han chot');
      } else if (deadlinesMissed > 0) {
        deadlineScore = Math.max(0, 25 - deadlinesMissed * 8);
        warnings.push(deadlinesMissed + ' nhiem vu co the khong hoan thanh truoc han chot');
      }
    } else {
      deadlineScore = 20; // No deadlines to evaluate
    }

    // ── Metric 4: Availability window compliance ──────────────────────────────
    var outsideAvailCount = 0;
    for (var awi = 0; awi < actions.length; awi++) {
      var awa = actions[awi];
      var awaStart = minFromTime(awa.startTime);
      var awaEnd = minFromTime(awa.endTime);
      if (awaStart < availStartMin || awaEnd > availEndMin) {
        outsideAvailCount++;
      }
    }
    var availScore = outsideAvailCount === 0 ? 15 : Math.max(0, 15 - outsideAvailCount * 5);
    if (outsideAvailCount === 0 && actions.length > 0) {
      strengths.push('Tat ca nhiem vu nam trong khung thoi gian kha dung');
    } else if (outsideAvailCount > 0) {
      warnings.push(outsideAvailCount + ' hanh dong nam ngoai khung thoi gian kha dung');
    }

    // ── Metric 5: Workload balance ─────────────────────────────────────────────
    var minutesByDay = {};
    for (var wli = 0; wli < taskActions.length; wli++) {
      var wld = taskActions[wli].date;
      minutesByDay[wld] = (minutesByDay[wld] || 0) + (taskActions[wli].durationMinutes || 0);
    }
    var dayMinutes = Object.values(minutesByDay);
    var balanceScore = 15;
    var overloadedDays = 0;
    for (var bli = 0; bli < dayMinutes.length; bli++) {
      var dm = dayMinutes[bli];
      if (dm > 300) { // > 5 hours on one day
        overloadedDays++;
      }
    }
    if (overloadedDays > 0) {
      balanceScore = Math.max(0, 15 - overloadedDays * 5);
      var overDayH = Math.max.apply(null, dayMinutes.filter(function(m) { return m > 300; }));
      warnings.push('Co ngay hoc kha day (' + Math.round(overDayH / 60 * 10) / 10 + ' gio)');
    } else if (daysCovered > 0) {
      strengths.push('Tai trong hoc tap phan bo deu giua cac ngay');
    }

    // ── Metric 6: Buffer / breathing room ─────────────────────────────────────
    var bufferScore = 10;
    var bufferIssues = 0;
    // Sort actions on each date and check gaps between consecutive ones
    var actionsByDate = {};
    for (var bfi = 0; bfi < taskActions.length; bfi++) {
      var bfa = taskActions[bfi];
      if (!actionsByDate[bfa.date]) actionsByDate[bfa.date] = [];
      actionsByDate[bfa.date].push(bfa);
    }
    var dates = Object.keys(actionsByDate);
    for (var dti = 0; dti < dates.length; dti++) {
      var dayActions = actionsByDate[dates[dti]].slice().sort(function(a, b) {
        return minFromTime(a.startTime) - minFromTime(b.startTime);
      });
      for (var dai = 0; dai < dayActions.length - 1; dai++) {
        var gap = minFromTime(dayActions[dai + 1].startTime) - minFromTime(dayActions[dai].endTime);
        if (gap < 5) { // less than 5 min gap = packed
          bufferIssues++;
        }
      }
    }
    if (bufferIssues === 0 && taskActions.length > 1) {
      strengths.push('Bao ton thoi gian nghi ngoi giua cac nhiem vu');
    } else if (bufferIssues > 0) {
      bufferScore = Math.max(0, 10 - bufferIssues * 3);
    }

    // ── Metric 7: Focus block quality (anti-fragmentation) ────────────────────
    var focusBlocksCount = 0;
    var shortFragments = 0;
    for (var fci = 0; fci < taskActions.length; fci++) {
      var fcDur = taskActions[fci].durationMinutes || 0;
      if (fcDur >= 45) {
        focusBlocksCount++;
      } else {
        shortFragments++;
      }
    }
    var totalBlocks = taskActions.length;
    var fragmentationRate = totalBlocks > 0 ? Math.round(shortFragments / totalBlocks * 100) / 100 : 0;
    var fragScore = shortFragments === 0 ? 5 : Math.max(0, 5 - shortFragments * 2);
    if (shortFragments === 0 && focusBlocksCount > 0) {
      strengths.push('Cac khoi hoc tap lien tuc, khong bi phan manh');
    }

    // ── Metric 8: Change Cost (Minimum Necessary Changes) ───────────────────
    var changeCost = proposal.changeCost !== undefined
      ? Number(proposal.changeCost)
      : actions.filter(function(a) { return a.type === 'move_task' || a.previousStartTime; }).length;

    if (changeCost > 0 && changeCost <= 3 && actions.length > 0) {
      strengths.push('Toi uu thay doi: Chi dieu chinh ' + changeCost + ' nhiem vu can thiet');
    }

    // ── Free minutes remaining (approximate) ──────────────────────────────────
    var availableMin = availEndMin - availStartMin;
    var freeMinutesRemaining = Math.max(0, availableMin - totalScheduledMinutes);

    // ── Final score ────────────────────────────────────────────────────────────
    var score = conflictScore + deadlineScore + availScore + balanceScore + bufferScore + fragScore;
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score: score,
      strengths: strengths,
      warnings: warnings,
      metrics: {
        totalScheduledMinutes: totalScheduledMinutes,
        freeMinutesRemaining: freeMinutesRemaining,
        focusBlocksCount: focusBlocksCount,
        fragmentationRate: fragmentationRate,
        daysCovered: daysCovered,
        conflictsCount: conflictsCount,
        changeCost: changeCost
      }
    };
  }

  /**
   * Compares the quality of the current baseline schedule vs the new proposal.
   */
  function evaluateRescheduleComparison(currentScheduleActions, proposedProposal, context) {
    var before = evaluatePlanQuality({ actions: currentScheduleActions || [] }, context);
    var after = evaluatePlanQuality(proposedProposal, context);
    return {
      beforeScore: before.score,
      afterScore: after.score,
      scoreDiff: after.score - before.score,
      changeCost: after.metrics.changeCost,
      improved: after.score >= before.score
    };
  }

  return {
    evaluatePlanQuality: evaluatePlanQuality,
    evaluateRescheduleComparison: evaluateRescheduleComparison
  };
}));
