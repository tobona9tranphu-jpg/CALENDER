'use strict';

/**
 * @file index.js
 * Unified entry point for AI Time Management Foundation (P1.1 + P1.2).
 *
 * Exposes:
 * - IntentSchema (createIntent, validateIntent, needsClarification)
 * - PlannerContext (buildPlanningContext, computeCalendarRevision, isContextSanitized)
 * - PlanningProposal (createPlanningProposal, validatePlanningProposal)
 * - AIProvider (AIProvider, PlaceholderAIProvider, DeterministicFallbackProvider, GeminiServerProvider, ClientAIAdapter)
 * - PlannerEngine (scheduleTasks, getFreeSlots, totalFreeMinutes, buildCapacityWarning) [P1.2]
 * - PlanEvaluator (evaluatePlanQuality) [P1.2]
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const IntentSchema = require('./intent-schema');
    const PlannerContext = require('./planner-context');
    const PlanningProposal = require('./planning-proposal');
    const AIProvider = require('./ai-provider');
    const PlannerEngine = require('./planner-engine');
    const PlanEvaluator = require('./plan-evaluator');
    module.exports = factory(IntentSchema, PlannerContext, PlanningProposal, AIProvider, PlannerEngine, PlanEvaluator);
  } else {
    root.AIFoundation = factory(
      root.IntentSchema,
      root.PlannerContext,
      root.PlanningProposal,
      root.AIProvider,
      root.PlannerEngine,
      root.PlanEvaluator
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  IntentSchema,
  PlannerContext,
  PlanningProposal,
  AIProvider,
  PlannerEngine,
  PlanEvaluator
) {
  return {
    ...IntentSchema,
    ...PlannerContext,
    ...PlanningProposal,
    ...AIProvider,
    ...PlannerEngine,
    ...PlanEvaluator,
    IntentSchema,
    PlannerContext,
    PlanningProposal,
    AIProvider,
    PlannerEngine,
    PlanEvaluator
  };
}));
