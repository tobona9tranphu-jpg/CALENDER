'use strict';

/**
 * @file capability-router.js
 * Capability Router, Slot Finder, Explain Schedule & Unified Response for P1.5 AI Assistant.
 *
 * Core Principles:
 * - Dispatches to existing deterministic engines without duplicating logic.
 * - findAvailableSlots: Computes up to 3 candidate slots with deterministic suitability score.
 * - explainSchedule: Factual, grounded explanation of daily schedule, capacity & pressures.
 * - handleDeadlineHelp: Deadline-driven planning ("Deadline -> Plan").
 * - Produces the Unified Response Model for all 9 intents.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppDate = require('../utils/date');
    const CapacityEngine = require('./capacity-engine');
    const DayFixEngine = require('./day-fix-engine');
    const DeadlineIntelligence = require('./deadline-intelligence');
    const ConflictIntelligence = require('./conflict-intelligence');
    const RescheduleEngine = require('./reschedule-engine');
    const PlanningProposal = require('./planning-proposal');
    const ExecutionTracker = require('../execution/execution-tracker');
    const PatternDetector = require('../execution/pattern-detector');
    const exportsObj = factory(
      AppDate,
      CapacityEngine,
      DayFixEngine,
      DeadlineIntelligence,
      ConflictIntelligence,
      RescheduleEngine,
      PlanningProposal,
      ExecutionTracker,
      PatternDetector
    );
    exportsObj.CapabilityRouter = exportsObj;
    module.exports = exportsObj;
  } else {
    root.CapabilityRouter = factory(
      root.AppDate,
      root.CapacityEngine,
      root.DayFixEngine,
      root.DeadlineIntelligence,
      root.ConflictIntelligence,
      root.RescheduleEngine,
      root.PlanningProposal,
      root.ExecutionTracker,
      root.PatternDetector
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  DateUtil,
  CapacityEngine,
  DayFixEngine,
  DeadlineIntelligence,
  ConflictIntelligence,
  RescheduleEngine,
  PlanningProposal,
  ExecutionTracker,
  PatternDetector
) {

  function getToday() {
    return (DateUtil && DateUtil.getTodayAppDate) ? DateUtil.getTodayAppDate() : new Date().toISOString().slice(0, 10);
  }

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
    if (DateUtil && DateUtil.addAppDays) return DateUtil.addAppDays(dateStr, n);
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Finds available unoccupied slots matching a requested duration on a given date.
   * Outputs up to 3 candidate slots with deterministic suitability scores.
   *
   * @param {Object} request - { durationMinutes, date, timePreference, subject }
   * @param {Object} context - Standard planning context
   * @returns {{ slots: Array<Object>, requestedDuration: number, date: string }}
   */
  function findAvailableSlots(request = {}, context = {}) {
    const dur = Math.max(15, Number(request.durationMinutes || 60));
    const targetDate = request.date || context.targetDate || context.currentDate || getToday();
    const timePref = request.timePreference || null; // 'morning' | 'afternoon' | 'evening'

    let capReport = (CapacityEngine && CapacityEngine.analyzeCapacity)
      ? CapacityEngine.analyzeCapacity(targetDate, context)
      : { blocks: { gaps: [] }, availableMinutes: 300, freeMinutes: 300 };

    let rawGaps = (capReport.blocks && Array.isArray(capReport.blocks.gaps)) ? capReport.blocks.gaps : [];

    // Fallback: If no gaps remaining from wall-clock time today, check full day availability window
    if (rawGaps.length === 0 && CapacityEngine && CapacityEngine.analyzeCapacity) {
      const fullDayReport = CapacityEngine.analyzeCapacity(targetDate, context, { currentTime: '00:00' });
      if (fullDayReport.blocks && Array.isArray(fullDayReport.blocks.gaps) && fullDayReport.blocks.gaps.length > 0) {
        rawGaps = fullDayReport.blocks.gaps;
      }
    }

    const candidateSlots = [];

    // Filter gaps that can fit the requested duration
    rawGaps.forEach(gap => {
      if (gap.durationMinutes >= dur) {
        // Can fit at least at gap start
        const slotStartMin = gap.startMin;
        const slotEndMin = slotStartMin + dur;

        candidateSlots.push({
          start: timeFromMin(slotStartMin),
          end: timeFromMin(slotEndMin),
          startMin: slotStartMin,
          endMin: slotEndMin,
          durationMinutes: dur,
          gapTotalMinutes: gap.durationMinutes,
          timeOfDay: slotStartMin < 720 ? 'morning' : (slotStartMin < 1080 ? 'afternoon' : 'evening')
        });

        // If the gap is significantly larger (>= 2x duration), also add a later option in the gap
        if (gap.durationMinutes >= dur * 2) {
          const midStartMin = Math.round((gap.startMin + gap.endMin - dur) / 15) * 15;
          if (midStartMin > slotStartMin && (midStartMin + dur) <= gap.endMin) {
            candidateSlots.push({
              start: timeFromMin(midStartMin),
              end: timeFromMin(midStartMin + dur),
              startMin: midStartMin,
              endMin: midStartMin + dur,
              durationMinutes: dur,
              gapTotalMinutes: gap.durationMinutes,
              timeOfDay: midStartMin < 720 ? 'morning' : (midStartMin < 1080 ? 'afternoon' : 'evening')
            });
          }
        }
      }
    });

    // Score candidates deterministically (0 - 100)
    candidateSlots.forEach(slot => {
      let score = 70; // Baseline

      // Preference alignment (+20 points)
      if (timePref && slot.timeOfDay === timePref) {
        score += 20;
      }

      // Prime study hours preference: 19:00 - 21:30 (+10) or 08:30 - 11:00 (+10)
      if ((slot.startMin >= 1140 && slot.endMin <= 1320) || (slot.startMin >= 510 && slot.endMin <= 660)) {
        score += 10;
      }

      // Spacing: prefer gaps where remaining buffer is >= 15m
      const remainingBuffer = slot.gapTotalMinutes - dur;
      if (remainingBuffer >= 15) score += 5;

      slot.suitabilityScore = Math.min(100, Math.max(0, score));
      slot.available = true;
      slot.conflicts = [];
      slot.deadlineImpact = 'safe';
    });

    // Sort by suitabilityScore descending
    candidateSlots.sort((a, b) => b.suitabilityScore - a.suitabilityScore);

    // Dedup similar start times within 30m
    const uniqueSlots = [];
    candidateSlots.forEach(slot => {
      const isTooClose = uniqueSlots.some(s => Math.abs(s.startMin - slot.startMin) < 30);
      if (!isTooClose) uniqueSlots.push(slot);
    });

    // Limit to top 3 slots
    return {
      date: targetDate,
      requestedDuration: dur,
      slots: uniqueSlots.slice(0, 3)
    };
  }

  /**
   * Grounded, factual explanation of daily schedule.
   *
   * @param {Object} context - Standardized context for target date
   * @returns {Object} Explanation breakdown
   */
  function explainSchedule(context = {}) {
    const targetDate = context.targetDate || context.currentDate || getToday();
    const fixedList = Array.isArray(context.fixedEvents) ? context.fixedEvents : [];
    const taskList = Array.isArray(context.scheduledTasks) ? context.scheduledTasks : [];
    const deadlineList = Array.isArray(context.deadlines) ? context.deadlines : [];

    const capReport = (CapacityEngine && CapacityEngine.analyzeCapacity)
      ? CapacityEngine.analyzeCapacity(targetDate, context)
      : { availableMinutes: 300, scheduledMinutes: 0, taskMinutes: 0, utilization: 0, isOverloaded: false };

    // Pressure drivers:
    const heavyTasks = taskList.filter(t => (t.durationMinutes || 45) >= 60);
    const movableTasks = taskList.filter(t => !t.locked && t.status !== 'done');
    const imminentDeadlines = deadlineList.filter(d => d.deadline === targetDate || d.deadlineDate === targetDate);

    const fixedCount = fixedList.length;
    const taskCount = taskList.length;
    const deadlineCount = imminentDeadlines.length;
    const utilPct = Math.round(capReport.utilization * 100);

    let summaryText = `Ngày ${targetDate} có ${fixedCount} lịch cố định, ${taskCount} ca học/nhiệm vụ và ${deadlineCount} hạn chót. Tổng tải sử dụng khoảng ${utilPct}% quỹ thời gian rảnh.`;

    if (capReport.isOverloaded || utilPct > 90) {
      const heavyTitles = heavyTasks.map(t => t.title).join(', ');
      summaryText += ` Lịch trình hiện tại đang trong tình trạng ${capReport.isOverloaded ? 'QUÁ TẢI' : 'RẤT DÀY'}. Áp lực chính đến từ các ca học dài (${heavyTitles || 'nhiều ca nhỏ'}) và ${deadlineCount > 0 ? 'hạn chót sắp đến' : 'thiếu đệm nghỉ'}.`;
    } else {
      summaryText += ' Nhịp học trong ngày phân bổ tương đối cân bằng.';
    }

    return {
      date: targetDate,
      fixedCount,
      taskCount,
      deadlineCount,
      utilizationPercentage: utilPct,
      isOverloaded: capReport.isOverloaded,
      pressureDrivers: heavyTasks.map(t => ({ id: t.id, title: t.title, durationMinutes: t.durationMinutes })),
      movableTasks: movableTasks.map(t => ({ id: t.id, title: t.title, durationMinutes: t.durationMinutes })),
      explanationText: summaryText
    };
  }

  /**
   * Handles "Deadline -> Plan" workflow.
   *
   * @param {Object} request - { subject, taskTitle, deadlineDate, durationMinutes }
   * @param {Object} context
   * @returns {Object} Structured proposal or warning
   */
  function handleDeadlineHelp(request = {}, context = {}) {
    const today = context.currentDate || getToday();
    const dlDate = request.deadlineDate || addDays(today, 2);
    const dur = Number(request.durationMinutes || 90);
    const title = request.taskTitle || (request.subject ? `Hoàn thành bài tập ${request.subject}` : 'Hoàn thành bài tập');

    // 1. Check capacity on target deadline date or day before
    const scheduleDate = dlDate <= today ? today : addDays(dlDate, -1);
    const slotResult = findAvailableSlots({ durationMinutes: dur, date: scheduleDate, timePreference: 'evening' }, context);

    if (slotResult.slots.length > 0) {
      const bestSlot = slotResult.slots[0];
      const action = {
        id: 'action-deadline-plan-' + Date.now(),
        type: 'schedule_task',
        title,
        date: scheduleDate,
        startTime: bestSlot.start,
        endTime: bestSlot.end,
        durationMinutes: dur,
        rationale: `Lên lịch trước hạn chót ${dlDate} 1 ngày vào khung giờ tối ưu ${bestSlot.start}–${bestSlot.end}.`
      };

      const proposal = (PlanningProposal && PlanningProposal.createPlanningProposal)
        ? PlanningProposal.createPlanningProposal({
            actions: [action],
            rationale: [action.rationale],
            source: 'deterministic'
          })
        : { actions: [action], rationale: [action.rationale] };

      return {
        status: 'proposal_ready',
        message: `Tôi đã lập kế hoạch cho hạn chót "${title}" (hạn: ${dlDate}). Đề xuất xếp lịch học vào ngày ${scheduleDate} từ ${bestSlot.start} đến ${bestSlot.end} để hoàn thành an toàn trước deadline.`,
        proposal,
        requiresConfirmation: true,
        data: { deadlineDate: dlDate, scheduledSlot: bestSlot }
      };
    }

    // If day before has no slot, try today
    const fallbackSlotResult = findAvailableSlots({ durationMinutes: dur, date: today }, context);
    if (fallbackSlotResult.slots.length > 0) {
      const bestSlot = fallbackSlotResult.slots[0];
      const action = {
        id: 'action-deadline-plan-today-' + Date.now(),
        type: 'schedule_task',
        title,
        date: today,
        startTime: bestSlot.start,
        endTime: bestSlot.end,
        durationMinutes: dur,
        rationale: `Lên lịch hôm nay ${today} ${bestSlot.start}–${bestSlot.end} để kịp hạn chót ${dlDate}.`
      };
      const proposal = (PlanningProposal && PlanningProposal.createPlanningProposal)
        ? PlanningProposal.createPlanningProposal({
            actions: [action],
            rationale: [action.rationale],
            source: 'deterministic'
          })
        : { actions: [action] };

      return {
        status: 'proposal_ready',
        message: `Các ngày sát hạn chót đang kín lịch. Tôi đề xuất làm ngay hôm nay (${today}) từ ${bestSlot.start}–${bestSlot.end} để đảm bảo nộp đúng hạn.`,
        proposal,
        requiresConfirmation: true,
        data: { deadlineDate: dlDate, scheduledSlot: bestSlot }
      };
    }

    // No capacity: Suggest Fix My Day
    return {
      status: 'action_preview',
      message: `Quỹ thời gian từ nay đến hạn chót (${dlDate}) đang quá tải, không có khoảng trống liên tục ${dur} phút. Bạn có muốn chạy "Fix My Day" để dời bớt ca học thứ yếu và giải phóng thời gian cho hạn chót này không?`,
      proposal: null,
      requiresConfirmation: false,
      actions: [
        { id: 'trigger_fix_day', label: '🪄 Khởi chạy Fix My Day', type: 'navigate', payload: { intent: 'fix_day' } }
      ],
      data: { deadlineDate: dlDate, requiredDuration: dur }
    };
  }

  /**
   * Main Capability Router.
   * Dispatches classified intent and context to the appropriate deterministic capability.
   *
   * @param {Object} classifiedIntent - Output from IntentRouter
   * @param {Object} context - Output from ContextAssembly
   * @param {Object} [options]
   * @returns {Object} Unified Response Model
   */
  function routeIntent(classifiedIntent, context = {}, options = {}) {
    if (!classifiedIntent || !classifiedIntent.intent) {
      return {
        status: 'error',
        message: 'Không xác định được ý định người dùng.',
        intent: 'unknown',
        data: null,
        proposal: null,
        requiresConfirmation: false,
        warnings: ['Thiếu thông tin intent'],
        actions: []
      };
    }

    const { intent, entities = {} } = classifiedIntent;
    const baseDate = context.currentDate || getToday();
    const targetDate = entities.date || context.targetDate || baseDate;

    switch (intent) {
      // 1. FIND TIME
      case 'find_time': {
        const slotResult = findAvailableSlots({
          durationMinutes: entities.durationMinutes || 60,
          date: targetDate,
          timePreference: entities.timePreference,
          subject: entities.subject
        }, context);

        if (slotResult.slots.length === 0) {
          return {
            status: 'information',
            message: `Không tìm thấy khoảng trống ${slotResult.requestedDuration} phút nào trong khung giờ rảnh ngày ${targetDate}. Bạn có thể cân nhắc giảm thời lượng hoặc dùng Fix My Day để dời bớt nhiệm vụ khác.`,
            intent,
            data: slotResult,
            proposal: null,
            requiresConfirmation: false,
            warnings: ['Không đủ thời gian rảnh liên tục'],
            actions: [
              { id: 'fix_day_btn', label: '🪄 Sửa lịch ngày này', type: 'route', payload: { intent: 'fix_day', date: targetDate } }
            ]
          };
        }

        const slotBullets = slotResult.slots.map((s, i) =>
          `${i + 1}. Khung giờ **${s.start} – ${s.end}** (Độ phù hợp: ${s.suitabilityScore}/100)`
        ).join('\n');

        return {
          status: 'information',
          message: `Tìm thấy **${slotResult.slots.length}** khung giờ rảnh phù hợp cho bạn vào ngày **${targetDate}** (thời lượng ${slotResult.requestedDuration} phút):\n\n${slotBullets}`,
          intent,
          data: slotResult,
          proposal: null,
          requiresConfirmation: false,
          warnings: [],
          actions: slotResult.slots.map((s, idx) => ({
            id: `select_slot_${idx}`,
            label: `Lên lịch ${s.start}–${s.end}`,
            type: 'plan_slot',
            payload: { date: targetDate, startTime: s.start, endTime: s.end, durationMinutes: s.durationMinutes, subject: entities.subject }
          }))
        };
      }

      // 2. EXPLAIN SCHEDULE
      case 'explain_schedule': {
        const expl = explainSchedule(context);
        return {
          status: 'information',
          message: expl.explanationText,
          intent,
          data: expl,
          proposal: null,
          requiresConfirmation: false,
          warnings: expl.isOverloaded ? ['Ngày đang quá tải'] : [],
          actions: expl.isOverloaded ? [
            { id: 'fix_day_action', label: '🪄 Tối ưu & Sửa lịch ngay', type: 'route', payload: { intent: 'fix_day', date: expl.date } }
          ] : []
        };
      }

      // 3. DEADLINE HELP
      case 'deadline_help': {
        const res = handleDeadlineHelp(entities, context);
        return {
          intent,
          warnings: [],
          actions: res.actions || [],
          ...res
        };
      }

      // 4. FIX MY DAY
      case 'fix_day': {
        if (DayFixEngine && DayFixEngine.analyzeDay && DayFixEngine.fixDay) {
          const diag = DayFixEngine.analyzeDay(targetDate, context, options);
          const proposal = DayFixEngine.fixDay(targetDate, context, options);

          const changeCount = (proposal && proposal.actions) ? proposal.actions.length : 0;
          const hardCount = (diag.hardConflicts || []).length;
          const overdueCount = (diag.overdueTasks || []).length;
          let msg = '';
          if (hardCount === 0 && !diag.isOverloaded && overdueCount === 0) {
            msg = `Lịch ngày ${targetDate} hiện rất cân bằng (Điểm sức khỏe: ${diag.healthScore || 100}/100). Không phát hiện xung đột hay quá tải nào cần xử lý.`;
          } else {
            msg = `Đã phát hiện vấn đề trong ngày ${targetDate}: ${hardCount} xung đột giờ, ${overdueCount} hạn chót rủi ro. Tôi đã tạo đề xuất khắc phục với ${changeCount} điều chỉnh lịch trình an toàn.`;
          }

          return {
            status: (changeCount > 0) ? 'proposal_ready' : 'information',
            message: msg,
            intent,
            data: { diagnosis: diag },
            proposal: (changeCount > 0) ? proposal : null,
            requiresConfirmation: changeCount > 0,
            warnings: diag.isOverloaded ? ['Ngày quá tải'] : [],
            actions: (changeCount > 0) ? [
              { id: 'apply_fix_day', label: '✓ Áp dụng đề xuất', type: 'apply_proposal', payload: proposal }
            ] : []
          };
        }
        return {
          status: 'error',
          message: 'DayFixEngine không khả dụng.',
          intent,
          data: null,
          proposal: null,
          requiresConfirmation: false,
          warnings: [],
          actions: []
        };
      }

      // 5. REVIEW DAY
      case 'review_day': {
        if (ExecutionTracker && ExecutionTracker.analyzeExecution) {
          const report = ExecutionTracker.analyzeExecution(targetDate, context);
          const sum = report.summary;
          const msg = `Tổng kết ngày ${targetDate}: Bạn đã hoàn thành ${sum.completedTasks}/${sum.totalTasks} ca học (${sum.completionRate}%). Tổng thời gian học thực tế là ${sum.actualMinutes} phút (Kế hoạch: ${sum.plannedMinutes} phút). Tỷ lệ tuân thủ giờ bắt đầu đạt ${sum.adherenceRate}%.`;

          return {
            status: 'information',
            message: msg,
            intent,
            data: report,
            proposal: null,
            requiresConfirmation: false,
            warnings: [],
            actions: [
              { id: 'open_dr_modal', label: '📊 Xem chi tiết Daily Review', type: 'open_modal', payload: { modal: 'dailyReviewModal' } }
            ]
          };
        }
        return {
          status: 'error',
          message: 'ExecutionTracker không khả dụng.',
          intent,
          data: null,
          proposal: null,
          requiresConfirmation: false,
          warnings: [],
          actions: []
        };
      }

      // 6. REVIEW WEEK
      case 'review_week': {
        if (ExecutionTracker && ExecutionTracker.analyzeExecution) {
          const pastTasks = Array.isArray(context.tasks) ? context.tasks : [];
          const pastSessions = Array.isArray(context.sessions) ? context.sessions : [];

          const completed = pastTasks.filter(t => t.status === 'completed' || t.status === 'done').length;
          const total = pastTasks.length || 1;
          const compRate = Math.round((completed / total) * 100);

          let totalMins = 0;
          pastSessions.forEach(s => { totalMins += Number(s.actualMinutes || s.minutes || 0); });
          const totalHours = (totalMins / 60).toFixed(1);

          let detectedPatterns = [];
          if (PatternDetector && PatternDetector.detectPatterns) {
            detectedPatterns = PatternDetector.detectPatterns(pastSessions, pastTasks);
          }

          let msg = `Tổng kết 7 ngày qua: Bạn hoàn thành ${completed}/${pastTasks.length} nhiệm vụ (${compRate}%). Tổng thời gian học tập là ${totalHours} giờ.`;
          if (detectedPatterns.length > 0) {
            msg += ` Hệ thống nhận diện được ${detectedPatterns.length} thói quen học tập cần lưu ý (xem Weekly Review).`;
          }

          return {
            status: 'information',
            message: msg,
            intent,
            data: { completed, total: pastTasks.length, compRate, totalHours, patterns: detectedPatterns },
            proposal: null,
            requiresConfirmation: false,
            warnings: [],
            actions: [
              { id: 'open_wr_modal', label: '📅 Mở Weekly Review', type: 'open_modal', payload: { modal: 'weeklyReviewModal' } }
            ]
          };
        }
        return {
          status: 'error',
          message: 'ExecutionTracker không khả dụng.',
          intent,
          data: null,
          proposal: null,
          requiresConfirmation: false,
          warnings: [],
          actions: []
        };
      }

      // 7. RESCHEDULE
      case 'reschedule': {
        if (RescheduleEngine && RescheduleEngine.generateReschedulePlan) {
          const reschResult = RescheduleEngine.generateReschedulePlan({
            targetDate,
            subject: entities.subject,
            timePreference: entities.timePreference
          }, context);

          if (reschResult && reschResult.proposal && reschResult.proposal.actions && reschResult.proposal.actions.length > 0) {
            return {
              status: 'proposal_ready',
              message: `Đã tìm thấy phương án dời lịch cho các ca học ngày ${targetDate}.`,
              intent,
              data: reschResult,
              proposal: reschResult.proposal,
              requiresConfirmation: true,
              warnings: [],
              actions: [
                { id: 'apply_reschedule', label: '✓ Áp dụng dời lịch', type: 'apply_proposal', payload: reschResult.proposal }
              ]
            };
          }
        }
        // Fallback: Use FixMyDay for safe rescheduling
        return routeIntent({ ...classifiedIntent, intent: 'fix_day' }, context, options);
      }

      // 8. CAPTURE TASK
      case 'capture_task': {
        const title = entities.taskTitle || (entities.subject ? `Bài tập ${entities.subject}` : 'Nhiệm vụ mới');
        const dur = Number(entities.durationMinutes || 45);
        const action = {
          id: 'action-capture-' + Date.now(),
          type: 'create_task',
          title,
          subjectId: entities.subject || null,
          durationMinutes: dur,
          date: entities.date || targetDate,
          deadline: entities.deadlineDate || null,
          priority: entities.priority || 3
        };

        return {
          status: 'action_preview',
          message: `Tôi đã sẵn sàng tạo nhiệm vụ mới: **"${title}"** (thời lượng ${dur} phút${entities.deadlineDate ? `, hạn chót: ${entities.deadlineDate}` : ''}). Bạn có muốn lưu vào danh sách không?`,
          intent,
          data: { task: action },
          proposal: { actions: [action] },
          requiresConfirmation: true,
          warnings: [],
          actions: [
            { id: 'confirm_capture', label: '✓ Lưu nhiệm vụ', type: 'apply_task', payload: action }
          ]
        };
      }

      // 9. PLAN (Schedule study task)
      case 'plan':
      default: {
        const dur = Number(entities.durationMinutes || 60);
        const sub = entities.subject || 'Học tập';
        const title = entities.taskTitle || `Học ${sub}`;

        // Find available slot
        const slotResult = findAvailableSlots({
          durationMinutes: dur,
          date: targetDate,
          timePreference: entities.timePreference,
          subject: sub
        }, context);

        if (slotResult.slots.length > 0) {
          const bestSlot = slotResult.slots[0];
          const action = {
            id: 'action-plan-' + Date.now(),
            type: 'schedule_task',
            title,
            date: targetDate,
            startTime: bestSlot.start,
            endTime: bestSlot.end,
            durationMinutes: dur,
            rationale: `Xếp lịch học ${sub} vào khung giờ rảnh tối ưu ${bestSlot.start}–${bestSlot.end} ngày ${targetDate}.`
          };

          const proposal = (PlanningProposal && PlanningProposal.createPlanningProposal)
            ? PlanningProposal.createPlanningProposal({
                actions: [action],
                rationale: [action.rationale],
                source: 'deterministic'
              })
            : { actions: [action], rationale: [action.rationale] };

          return {
            status: 'proposal_ready',
            message: `Tôi đề xuất xếp ca **"${title}"** (${dur} phút) vào ngày **${targetDate}**:\n\nKhung giờ: **${bestSlot.start} – ${bestSlot.end}** (Độ phù hợp: ${bestSlot.suitabilityScore}/100, không có xung đột).\n\nBạn có muốn áp dụng lịch này không?`,
            intent: 'plan',
            data: { slot: bestSlot },
            proposal,
            requiresConfirmation: true,
            warnings: [],
            actions: [
              { id: 'apply_plan', label: '✓ Áp dụng lên lịch', type: 'apply_proposal', payload: proposal }
            ]
          };
        } else {
          return {
            status: 'information',
            message: `Không tìm thấy khung giờ rảnh liên tục ${dur} phút cho môn ${sub} vào ngày ${targetDate}. Bạn có muốn chạy Fix My Day để sắp xếp lại không?`,
            intent: 'plan',
            data: slotResult,
            proposal: null,
            requiresConfirmation: false,
            warnings: ['Không đủ thời gian rảnh'],
            actions: [
              { id: 'fix_day_btn', label: '🪄 Sửa lịch ngày này', type: 'route', payload: { intent: 'fix_day', date: targetDate } }
            ]
          };
        }
      }
    }
  }

  return {
    findAvailableSlots,
    explainSchedule,
    handleDeadlineHelp,
    routeIntent
  };
}));
