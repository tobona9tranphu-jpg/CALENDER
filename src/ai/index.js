'use strict';

/**
 * @file index.js
 * Unified entry point for AI Time Management System (P1.1, P1.2, P1.3, P1.4, P1.5).
 *
 * Exposes:
 * - IntentSchema, PlannerContext, PlanningProposal, AIProvider, PlannerEngine, PlanEvaluator
 * - ConflictIntelligence, CapacityEngine, ScheduleDrift, DeadlineIntelligence, RescheduleEngine, DayFixEngine
 * - ExecutionTracker, PatternDetector, AdaptiveLearning [P1.4]
 * - IntentRouter, ContextAssembly, CapabilityRouter, AssistantConversation, TimeAssistant [P1.5]
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
    const CapacityEngine = require('./capacity-engine');
    const ScheduleDrift = require('./schedule-drift');
    const DeadlineIntelligence = require('./deadline-intelligence');
    const RescheduleEngine = require('./reschedule-engine');
    const DayFixEngine = require('./day-fix-engine');
    const ExecutionTracker = require('../execution/execution-tracker');
    const PatternDetector = require('../execution/pattern-detector');
    const AdaptiveLearning = require('../execution/adaptive-learning');
    const IntentRouter = require('./intent-router');
    const ContextAssembly = require('./context-assembly');
    const CapabilityRouter = require('./capability-router');
    const AssistantConversation = require('./assistant-conversation');
    const TimeAssistant = require('./time-assistant');
    module.exports = factory(
      IntentSchema,
      PlannerContext,
      PlanningProposal,
      AIProvider,
      PlannerEngine,
      PlanEvaluator,
      ConflictIntelligence,
      CapacityEngine,
      ScheduleDrift,
      DeadlineIntelligence,
      RescheduleEngine,
      DayFixEngine,
      ExecutionTracker,
      PatternDetector,
      AdaptiveLearning,
      IntentRouter,
      ContextAssembly,
      CapabilityRouter,
      AssistantConversation,
      TimeAssistant
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
      root.CapacityEngine,
      root.ScheduleDrift,
      root.DeadlineIntelligence,
      root.RescheduleEngine,
      root.DayFixEngine,
      root.ExecutionTracker,
      root.PatternDetector,
      root.AdaptiveLearning,
      root.IntentRouter,
      root.ContextAssembly,
      root.CapabilityRouter,
      root.AssistantConversation,
      root.TimeAssistant
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
  CapacityEngine,
  ScheduleDrift,
  DeadlineIntelligence,
  RescheduleEngine,
  DayFixEngine,
  ExecutionTracker,
  PatternDetector,
  AdaptiveLearning,
  IntentRouter,
  ContextAssembly,
  CapabilityRouter,
  AssistantConversation,
  TimeAssistant
) {
  return {
    ...IntentSchema,
    ...PlannerContext,
    ...PlanningProposal,
    ...AIProvider,
    ...PlannerEngine,
    ...PlanEvaluator,
    ...ConflictIntelligence,
    ...CapacityEngine,
    ...ScheduleDrift,
    ...DeadlineIntelligence,
    ...RescheduleEngine,
    ...DayFixEngine,
    ...(ExecutionTracker || {}),
    ...(PatternDetector || {}),
    ...(AdaptiveLearning || {}),
    ...(IntentRouter || {}),
    ...(ContextAssembly || {}),
    ...(CapabilityRouter || {}),
    ...(AssistantConversation || {}),
    ...(TimeAssistant || {}),
    IntentSchema,
    PlannerContext,
    PlanningProposal,
    AIProvider,
    PlannerEngine,
    PlanEvaluator,
    ConflictIntelligence,
    CapacityEngine,
    ScheduleDrift,
    DeadlineIntelligence,
    RescheduleEngine,
    DayFixEngine,
    ExecutionTracker,
    PatternDetector,
    AdaptiveLearning,
    IntentRouter,
    ContextAssembly,
    CapabilityRouter,
    AssistantConversation,
    TimeAssistant
  };
}));
