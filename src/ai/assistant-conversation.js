'use strict';

/**
 * @file assistant-conversation.js
 * Multi-turn Conversational State Management for P1.5 AI Assistant.
 *
 * Capabilities:
 * - Retains short-term context across follow-up queries.
 * - Handles clarification dialogues (e.g., Turn 1: "Mai tôi học Lý" -> Question -> Turn 2: "90p").
 * - Merges follow-up answers into pending entities without asking the user to re-enter.
 * - Provides non-destructive reset.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const IntentRouter = require('./intent-router');
    const exportsObj = factory(IntentRouter);
    exportsObj.AssistantConversation = exportsObj;
    module.exports = exportsObj;
  } else {
    root.AssistantConversation = factory(root.IntentRouter);
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (IntentRouter) {

  class ConversationManager {
    constructor() {
      this.reset();
    }

    reset() {
      this.lastIntent = null;
      this.pendingEntities = {};
      this.pendingQuestion = null;
      this.missingField = null;
      this.lastProposal = null;
      this.history = [];
    }

    getState() {
      return {
        lastIntent: this.lastIntent,
        pendingEntities: { ...this.pendingEntities },
        pendingQuestion: this.pendingQuestion,
        missingField: this.missingField,
        lastProposal: this.lastProposal,
        turnCount: this.history.length
      };
    }

    isAwaitingClarification() {
      return Boolean(this.pendingQuestion && this.missingField);
    }

    /**
     * Records a message from user.
     */
    addUserMessage(text) {
      this.history.push({
        role: 'user',
        text: String(text || '').trim(),
        timestamp: Date.now()
      });
      // Keep at most 10 recent messages in memory
      if (this.history.length > 10) this.history.shift();
    }

    /**
     * Records assistant response and sets pending state if clarification is needed.
     */
    addAssistantResponse(response) {
      const respObj = response || {};
      this.history.push({
        role: 'assistant',
        message: respObj.message || '',
        status: respObj.status || 'information',
        intent: respObj.intent || null,
        timestamp: Date.now()
      });
      if (this.history.length > 10) this.history.shift();

      if (respObj.status === 'needs_clarification') {
        this.pendingQuestion = respObj.message;
        this.missingField = respObj.data && respObj.data.missingField ? respObj.data.missingField : null;
      } else {
        this.pendingQuestion = null;
        this.missingField = null;
      }

      if (respObj.proposal) {
        this.lastProposal = respObj.proposal;
      }
    }

    /**
     * Attempts to merge a user answer into pending entities when clarification was awaiting.
     *
     * @param {string} answerText
     * @returns {{ merged: boolean, intent: Object|null }}
     */
    processFollowUp(answerText) {
      const text = String(answerText || '').trim();
      const lower = text.toLowerCase();

      // Check if user is answering an active clarification question
      if (this.isAwaitingClarification() && this.lastIntent) {
        const field = this.missingField;

        if (field === 'durationMinutes') {
          const dur = IntentRouter && IntentRouter._parseDurationMinutes
            ? IntentRouter._parseDurationMinutes(text)
            : (parseInt(text, 10) || null);

          if (dur) {
            this.pendingEntities.durationMinutes = dur;
            const completedIntent = {
              ...this.lastIntent,
              entities: {
                ...this.pendingEntities
              }
            };
            this.pendingQuestion = null;
            this.missingField = null;
            return { merged: true, intent: completedIntent };
          }
        }
      }

      // Check if user is requesting a tweak to previous proposal (e.g., "Đổi sang 8 giờ tối", "Chuyển sang ngày mai")
      if (this.lastIntent && (lower.includes('đổi sang') || lower.includes('chuyển sang') || lower.includes('lùi lại') || lower.includes('dời sang'))) {
        const dur = IntentRouter && IntentRouter._parseDurationMinutes ? IntentRouter._parseDurationMinutes(text) : null;
        const dateRef = IntentRouter && IntentRouter._parseDateReference ? IntentRouter._parseDateReference(text) : null;

        // Check time: "8 giờ tối" -> 20:00, "20:00", "8h tối"
        let targetTime = null;
        let timePref = null;
        const eveningMatch = text.match(/(?:\b|\s)(?:(\d{1,2})\s*(?:giờ|h)\s*tối|(?:20|21|19|18):00)/i);
        if (eveningMatch) {
          if (eveningMatch[1]) {
            const h = Number(eveningMatch[1]);
            targetTime = (h < 12 ? h + 12 : h) + ':00';
          } else {
            targetTime = eveningMatch[0].trim();
          }
          timePref = 'evening';
        } else if (lower.includes('sáng')) {
          timePref = 'morning';
        } else if (lower.includes('chiều')) {
          timePref = 'afternoon';
        } else if (lower.includes('tối')) {
          timePref = 'evening';
        }

        const updatedEntities = {
          ...this.pendingEntities,
          ...(dur ? { durationMinutes: dur } : {}),
          ...(dateRef ? { date: dateRef } : {}),
          ...(targetTime ? { targetTime } : {}),
          ...(timePref ? { timePreference: timePref } : {})
        };

        this.pendingEntities = updatedEntities;
        return {
          merged: true,
          intent: {
            ...this.lastIntent,
            intent: this.lastIntent.intent || 'plan',
            entities: updatedEntities
          }
        };
      }

      return { merged: false, intent: null };
    }

    /**
     * Updates conversational state with newly parsed intent.
     */
    updateIntent(classifiedIntent) {
      if (!classifiedIntent) return;
      this.lastIntent = classifiedIntent;
      this.pendingEntities = {
        ...(this.pendingEntities || {}),
        ...((classifiedIntent.entities) || {})
      };
    }
  }

  return {
    ConversationManager
  };
}));
