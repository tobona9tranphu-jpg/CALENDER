'use strict';

/**
 * Accessible Toast UI - Manages non-blocking toast notifications with ARIA live regions,
 * pause on hover, keyboard dismissal, and stacked queue presentation.
 *
 * Designed to be UMD compliant (usable in both Node.js / Jest tests and Browser environments).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ToastUI = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {

  const DEFAULT_TOAST_DURATION = 4000;
  const CRITICAL_TOAST_DURATION = 8000;

  class ToastUI {
    /**
     * @param {Object} [options]
     * @param {HTMLElement|string} [options.container] - DOM element or selector for toast container
     */
    constructor(options = {}) {
      this.containerSelector = typeof options.container === 'string' ? options.container : '#toastContainer';
      this.container = typeof options.container === 'object' ? options.container : null;
      this.activeToasts = new Map(); // id -> { element, timer, remaining, startTime }
    }

    /**
     * Ensures toast container exists in the DOM.
     * @returns {HTMLElement|null}
     */
    ensureContainer() {
      if (typeof document === 'undefined') return null;

      if (!this.container) {
        this.container = document.querySelector(this.containerSelector);
      }

      if (!this.container) {
        const div = document.createElement('div');
        div.id = 'toastContainer';
        div.className = 'tb-toast-container';
        // Container has no role itself, children have role="status" or role="alert"
        div.setAttribute('aria-label', 'Thông báo hệ thống');
        document.body.appendChild(div);
        this.container = div;
      }

      return this.container;
    }

    /**
     * Shows an accessible toast message.
     *
     * @param {Object} notification - Standard notification object
     * @param {Object} [options]
     * @param {number} [options.duration] - Auto dismiss duration in ms
     * @param {Function} [options.onDismiss]
     * @returns {HTMLElement|null}
     */
    show(notification, options = {}) {
      if (typeof document === 'undefined') return null;

      const container = this.ensureContainer();
      if (!container) return null;

      const notifId = notification.id || `toast-${Date.now()}`;
      const isCritical = notification.priority === 'CRITICAL' || notification.severity === 'danger';
      const duration = options.duration || (isCritical ? CRITICAL_TOAST_DURATION : DEFAULT_TOAST_DURATION);

      // Create toast element
      const toastEl = document.createElement('div');
      toastEl.id = `tb-toast-${notifId}`;
      toastEl.className = `tb-toast tb-toast-${notification.severity || 'info'} tb-toast-priority-${(notification.priority || 'medium').toLowerCase()}`;

      // ARIA accessibility attributes:
      // Assertive for critical/errors, polite for standard notices
      if (isCritical) {
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');
      } else {
        toastEl.setAttribute('role', 'status');
        toastEl.setAttribute('aria-live', 'polite');
        toastEl.setAttribute('aria-atomic', 'true');
      }

      // Safe text construction
      const title = notification.title ? String(notification.title) : '';
      const message = notification.message ? String(notification.message) : '';

      let actionHtml = '';
      if (notification.action && notification.action.label) {
        actionHtml = `<button type="button" class="tb-toast-action" aria-label="${escapeHTML(notification.action.label)}">${escapeHTML(notification.action.label)}</button>`;
      }

      toastEl.innerHTML = `
        <div class="tb-toast-content">
          ${title ? `<strong class="tb-toast-title">${escapeHTML(title)}</strong>` : ''}
          <div class="tb-toast-message">${escapeHTML(message)}</div>
          ${actionHtml}
        </div>
        <button type="button" class="tb-toast-close" aria-label="Đóng thông báo" title="Đóng">×</button>
      `;

      // Event handlers: action button
      if (notification.action && typeof notification.action.onClick === 'function') {
        const actionBtn = toastEl.querySelector('.tb-toast-action');
        if (actionBtn) {
          actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
              notification.action.onClick(notification);
            } catch (err) {
              console.error('Error executing toast action:', err);
            }
            this.dismiss(notifId);
          });
        }
      }

      // Event handlers: dismiss button
      const closeBtn = toastEl.querySelector('.tb-toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismiss(notifId, options.onDismiss);
        });
      }

      // Timing & Pause on hover
      const toastState = {
        element: toastEl,
        timer: null,
        duration,
        remaining: duration,
        startTime: Date.now(),
        onDismiss: options.onDismiss
      };

      const startTimer = () => {
        toastState.startTime = Date.now();
        toastState.timer = setTimeout(() => {
          this.dismiss(notifId, options.onDismiss);
        }, toastState.remaining);
      };

      const pauseTimer = () => {
        if (toastState.timer) {
          clearTimeout(toastState.timer);
          toastState.timer = null;
          const elapsed = Date.now() - toastState.startTime;
          toastState.remaining = Math.max(500, toastState.remaining - elapsed);
        }
      };

      toastEl.addEventListener('mouseenter', pauseTimer);
      toastEl.addEventListener('mouseleave', startTimer);
      toastEl.addEventListener('focusin', pauseTimer);
      toastEl.addEventListener('focusout', startTimer);

      // Append and animate in
      container.appendChild(toastEl);
      this.activeToasts.set(notifId, toastState);

      // Trigger animation
      requestAnimationFrame(() => {
        toastEl.classList.add('tb-toast-visible');
      });

      startTimer();
      return toastEl;
    }

    /**
     * Dismisses a toast by its notification ID.
     * @param {string} notifId
     * @param {Function} [onDismissCallback]
     */
    dismiss(notifId, onDismissCallback) {
      const toastState = this.activeToasts.get(notifId);
      if (!toastState) return;

      if (toastState.timer) {
        clearTimeout(toastState.timer);
        toastState.timer = null;
      }

      const el = toastState.element;
      el.classList.remove('tb-toast-visible');
      el.classList.add('tb-toast-hiding');

      setTimeout(() => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
        this.activeToasts.delete(notifId);

        const cb = onDismissCallback || toastState.onDismiss;
        if (typeof cb === 'function') {
          try {
            cb(notifId);
          } catch (err) {
            console.error('Error in toast onDismiss callback:', err);
          }
        }
      }, 250);
    }

    /**
     * Dismisses all currently visible toasts.
     */
    dismissAll() {
      for (const id of Array.from(this.activeToasts.keys())) {
        this.dismiss(id);
      }
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return {
    ToastUI,
    DEFAULT_TOAST_DURATION,
    CRITICAL_TOAST_DURATION
  };
}));
