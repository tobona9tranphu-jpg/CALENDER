'use strict';

/**
 * @file time-assistant.js
 * Unified AI Personal Time Assistant Orchestrator for P1.5.
 *
 * Core Principles:
 * - Single entry point: TimeAssistant.handleUserQuery(query, currentUser, options).
 * - Multi-turn conversational flow (clarification & follow-ups).
 * - Intent extraction with AI Provider & robust Deterministic Fallback.
 * - Lean context assembly based on intent.
 * - Deterministic Capability Routing (zero duplication of engine logic).
 * - Unified Response Model.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const IntentRouter = require('./intent-router');
    const ContextAssembly = require('./context-assembly');
    const CapabilityRouter = require('./capability-router');
    const AssistantConversation = require('./assistant-conversation');
    const exportsObj = factory(IntentRouter, ContextAssembly, CapabilityRouter, AssistantConversation);
    exportsObj.TimeAssistant = exportsObj;
    module.exports = exportsObj;
  } else {
    root.TimeAssistant = factory(
      root.IntentRouter,
      root.ContextAssembly,
      root.CapabilityRouter,
      root.AssistantConversation
    );
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (
  IntentRouter,
  ContextAssembly,
  CapabilityRouter,
  AssistantConversation
) {

  const convManager = (AssistantConversation && AssistantConversation.ConversationManager)
    ? new AssistantConversation.ConversationManager()
    : {
        addUserMessage: () => {},
        addAssistantResponse: () => {},
        processFollowUp: () => ({ merged: false, intent: null }),
        updateIntent: () => {},
        reset: () => {},
        getState: () => ({})
      };

  /**
   * Main Assistant Handler.
   *
   * @param {string} query - Raw user message
   * @param {Object} currentUser - Current user state
   * @param {Object} [options] - { aiAdapter, currentDate, currentTime }
   * @returns {Promise<Object>} Unified Response Model
   */
  async function handleUserQuery(query, currentUser = {}, options = {}) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) {
      return {
        status: 'information',
        message: 'Bạn muốn tôi giúp gì với lịch trình học tập của bạn hôm nay?',
        intent: 'help',
        data: null,
        proposal: null,
        requiresConfirmation: false,
        warnings: [],
        actions: []
      };
    }

    convManager.addUserMessage(rawQuery);

    const userPrefs = (currentUser && currentUser.settings && currentUser.settings.learnedPreferences) || {};

    // 1. Check if user is responding to an open clarification question or tweaking a previous proposal
    const followUp = convManager.processFollowUp(rawQuery);
    let classifiedIntent = null;

    if (followUp && followUp.merged && followUp.intent) {
      classifiedIntent = followUp.intent;
    } else {
      // 2. Classify intent: Try AI Provider if available, else Deterministic Fallback
      let aiIntent = null;
      if (options.aiAdapter && typeof options.aiAdapter.parseAssistantIntent === 'function') {
        try {
          const aiResult = await options.aiAdapter.parseAssistantIntent(rawQuery, {
            currentDate: options.currentDate,
            subjects: currentUser.subjects || []
          });
          if (aiResult && aiResult.intent) {
            const val = IntentRouter.validateIntentSchema(aiResult.intent);
            if (val.valid) {
              aiIntent = val.intent;
            }
          }
        } catch (aiErr) {
          // AI unavailable or timed out: safely proceed to deterministic fallback
        }
      }

      // Fallback to deterministic NLP classifier
      if (!aiIntent) {
        classifiedIntent = IntentRouter.classifyDeterministic(rawQuery, {
          currentDate: options.currentDate,
          subjects: currentUser.subjects || []
        });
      } else {
        classifiedIntent = aiIntent;
      }
    }

    // 3. Ambiguity Check: Do we need clarification before acting?
    const ambiguity = IntentRouter.detectAmbiguity(classifiedIntent, userPrefs);
    if (ambiguity.needsClarification) {
      convManager.updateIntent(classifiedIntent);
      const clarifResponse = {
        status: 'needs_clarification',
        message: ambiguity.question,
        intent: classifiedIntent.intent,
        data: { missingField: ambiguity.missingField },
        proposal: null,
        requiresConfirmation: false,
        warnings: [],
        actions: []
      };
      convManager.addAssistantResponse(clarifResponse);
      return clarifResponse;
    }

    convManager.updateIntent(classifiedIntent);

    // 4. Context Assembly tailored to this intent
    const intentType = classifiedIntent.intent;
    const targetDate = classifiedIntent.entities && classifiedIntent.entities.date
      ? classifiedIntent.entities.date
      : (options.currentDate || null);

    const context = ContextAssembly.buildIntentContext(currentUser, intentType, {
      currentDate: options.currentDate,
      currentTime: options.currentTime,
      targetDate
    });

    // 5. Capability Router: Dispatch to deterministic engine
    const response = CapabilityRouter.routeIntent(classifiedIntent, context, options);

    convManager.addAssistantResponse(response);
    return response;
  }

  function resetConversation() {
    convManager.reset();
  }

  function getConversationState() {
    return convManager.getState();
  }

  return {
    handleUserQuery,
    resetConversation,
    getConversationState,
    _convManager: convManager
  };
}));
