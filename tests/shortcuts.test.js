const assert = require('node:assert/strict');
const test = require('node:test');

const { ACTIONS, GLOBAL_SHORTCUTS, getAcceleratorsForAction, getShortcutAction } = require('../shortcuts');

test('maps function keys to app actions', () => {
  assert.equal(getShortcutAction({ key: 'F9' }), ACTIONS.QUIT);
  assert.equal(getShortcutAction({ key: 'F10' }), ACTIONS.TOGGLE_FULLSCREEN);
});

test('maps Shift+9 and Shift+0 to app actions', () => {
  assert.equal(getShortcutAction({ code: 'Digit9', key: '(', shiftKey: true }), ACTIONS.QUIT);
  assert.equal(getShortcutAction({ code: 'Digit9', key: '9', shift: true }), ACTIONS.QUIT);
  assert.equal(getShortcutAction({ code: 'Digit0', key: ')', shiftKey: true }), ACTIONS.TOGGLE_FULLSCREEN);
  assert.equal(getShortcutAction({ code: 'Digit0', key: '0', shift: true }), ACTIONS.TOGGLE_FULLSCREEN);
});

test('ignores non-shortcut and modified digit input', () => {
  assert.equal(getShortcutAction({ code: 'Digit9', key: '9' }), null);
  assert.equal(getShortcutAction({ code: 'Digit0', key: '0' }), null);
  assert.equal(getShortcutAction({ code: 'Digit9', key: '(', shiftKey: true, ctrlKey: true }), null);
  assert.equal(getShortcutAction({ key: 'F9', altKey: true }), null);
});

test('exposes global accelerators for registration', () => {
  assert.deepEqual(
    getAcceleratorsForAction(ACTIONS.QUIT),
    ['F9', 'Shift+9'],
  );
  assert.deepEqual(
    getAcceleratorsForAction(ACTIONS.TOGGLE_FULLSCREEN),
    ['F10', 'Shift+0'],
  );
  assert.equal(GLOBAL_SHORTCUTS.length, 4);
});
