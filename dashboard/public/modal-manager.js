'use strict';

(function exposeModalManager(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FoundationModalManager = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function modalManagerFactory() {
  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function createModalManager({ document, shell, skipLink }) {
    let activeModal = null;
    let returnFocus = null;
    let dismissible = false;

    function focusableElements(modal) {
      return Array.from(modal.querySelectorAll(FOCUSABLE))
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    }

    function open(modal, initialFocus, options = {}) {
      if (!activeModal) returnFocus = document.activeElement;
      else if (activeModal !== modal) activeModal.hidden = true;

      activeModal = modal;
      dismissible = options.dismissible === true;
      modal.hidden = false;
      shell.inert = true;
      skipLink.hidden = true;

      const target = initialFocus || focusableElements(modal)[0] || modal;
      if (typeof target.focus === 'function') target.focus();
    }

    function close(modal, options = {}) {
      modal.hidden = true;
      if (activeModal !== modal) return;

      activeModal = null;
      dismissible = false;
      shell.inert = false;
      skipLink.hidden = false;

      const target = returnFocus;
      returnFocus = null;
      if (options.restoreFocus !== false && target?.isConnected !== false
          && typeof target?.focus === 'function') target.focus();
    }

    function onKeydown(event) {
      if (!activeModal) return;
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        close(activeModal);
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements(activeModal);
      if (!elements.length) {
        event.preventDefault();
        activeModal.focus();
        return;
      }

      const index = elements.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        elements[elements.length - 1].focus();
      } else if (!event.shiftKey && (index < 0 || index === elements.length - 1)) {
        event.preventDefault();
        elements[0].focus();
      }
    }

    document.addEventListener('keydown', onKeydown);
    return {
      open,
      close,
      active: () => activeModal,
      destroy: () => document.removeEventListener('keydown', onKeydown),
    };
  }

  return { createModalManager };
}));
