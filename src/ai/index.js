'use strict';

/**
 * @file index.js
 * Unified entry point for AI Time Management System (P1.1, P1.2, P1.3).
 *
 * Exposes:
 * - IntentSchema (createIntent, validateIntent, needsClarification)
 * - PlannerContext (buildPlanningContext, canonicalizePlanningContext, computePlanningContextRevision, computeCalendarRevision, isContextSanitized)
 * - PlanningProposal (createPlanningProposal, validatePlanningProposal)
 * - AIProvider (AIProvider, PlaceholderAIProvider, DeterministicFallbackProvider, GeminiServerProvider, ClientAIAdapter)
 * - PlannerEngine (scheduleTasks, getFreeSlots, totalFreeMinutes, buildCapacityWarning)
 * - PlanEvaluator (evaluatePlanQuality, evaluateRescheduleComparison)
 * - ConflictIntelligence (detectConflicts) [P1.3]
 * - ScheduleDrift (analyzeScheduleDrift) [P1.3]
 * - DeadlineIntelligence (evaluateDeadlineRisks, formatDurationVi) [P1.3]
 * - RescheduleEngine (generateReschedulePlan) [P1.3]
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const IntentSchema = require('./intent-schema');
    const PlannerContext = require('./planner-context');
    const PlanningProposal = require('./planning-proposal');
    const AIProvider = require('./ai-provider');
    const PlannerEngine = require('./planner-engine');
    const PlanEvaluator = require('./plan-evaluator');
    const ConflictIntelligence = require('./conflict-intelligence');
    const ScheduleDrift = require('./schedule-drift');
    const DeadlineIntelligence = require('./deadline-intelligence');
    const RescheduleEngine = require('./reschedule-engine');
    module.exports = factory(
      IntentSchema,
      PlannerContext,
      PlanningProposal,
      AIProvider,
      PlannerEngine,
      PlanEvaluator,
      ConflictIntelligence,
      ScheduleDrift,
      DeadlineIntelligence,
      RescheduleEngine
    );
  } else {
    root.AIFoundation = factory(
      root.IntentSchema,
      root.PlannerContext,
      root.PlanningProposal,
      root.AIProvider,
      root.PlannerEngine,
      root.PlanEvaluator,
      root.ConflictIntelligence,
      root.ScheduleDrift,
      root.DeadlineIntelligence,
      root.RescheduleEngine
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  IntentSchema,
  PlannerContext,
  PlanningProposal,
  AIProvider,
  PlannerEngine,
  PlanEvaluator,
  ConflictIntelligence,
  ScheduleDrift,
  DeadlineIntelligence,
  RescheduleEngine
) {
  return {
    ...IntentSchema,
    ...PlannerContext,
    ...PlanningProposal,
    ...AIProvider,
    ...PlannerEngine,
    ...PlanEvaluator,
    ...ConflictIntelligence,
    ...ScheduleDrift,
    ...DeadlineIntelligence,
    ...RescheduleEngine,
    IntentSchema,
    PlannerContext,
    PlanningProposal,
    AIProvider,
    PlannerEngine,
    PlanEvaluator,
    ConflictIntelligence,
    ScheduleDrift,
    DeadlineIntelligence,
    RescheduleEngine
  };
}));
