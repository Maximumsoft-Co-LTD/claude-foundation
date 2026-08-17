'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createModalManager } = require('../public/modal-manager.js');

function fixture() {
  const listeners = new Map();
  const document = {
    activeElement: null,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
  };
  function element(children = []) {
    return {
      hidden: false,
      inert: false,
      isConnected: true,
      focus() { document.activeElement = this; },
      getAttribute() { return null; },
      querySelectorAll() { return children; },
    };
  }
  const shell = element();
  const skipLink = element();
  const returnTarget = element();
  document.activeElement = returnTarget;
  const manager = createModalManager({ document, shell, skipLink });
  return { document, listeners, manager, shell, skipLink, returnTarget, element };
}

function keydown(listeners, key, shiftKey = false) {
  let prevented = false;
  listeners.get('keydown')({ key, shiftKey, preventDefault() { prevented = true; } });
  return prevented;
}

test('opening a modal makes dashboard content inert and traps keyboard focus', () => {
  const f = fixture();
  const first = f.element();
  const last = f.element();
  const modal = f.element([first, last]);
  modal.hidden = true;

  f.manager.open(modal, first);
  assert.equal(modal.hidden, false);
  assert.equal(f.shell.inert, true);
  assert.equal(f.skipLink.hidden, true);
  assert.equal(f.document.activeElement, first);

  last.focus();
  assert.equal(keydown(f.listeners, 'Tab'), true);
  assert.equal(f.document.activeElement, first);

  first.focus();
  assert.equal(keydown(f.listeners, 'Tab', true), true);
  assert.equal(f.document.activeElement, last);
});

test('Escape closes a dismissible modal and restores the invoking control', () => {
  const f = fixture();
  const input = f.element();
  const modal = f.element([input]);
  modal.hidden = true;

  f.manager.open(modal, input, { dismissible: true });
  assert.equal(keydown(f.listeners, 'Escape'), true);
  assert.equal(modal.hidden, true);
  assert.equal(f.shell.inert, false);
  assert.equal(f.skipLink.hidden, false);
  assert.equal(f.document.activeElement, f.returnTarget);
});

test('Escape cannot dismiss the required dashboard-key gate', () => {
  const f = fixture();
  const input = f.element();
  const modal = f.element([input]);
  modal.hidden = true;

  f.manager.open(modal, input);
  assert.equal(keydown(f.listeners, 'Escape'), false);
  assert.equal(modal.hidden, false);
  assert.equal(f.shell.inert, true);
});
