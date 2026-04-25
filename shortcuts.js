(function exposeShortcuts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.tvShortcuts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShortcuts() {
  'use strict';

  const ACTIONS = Object.freeze({
    QUIT: 'quit',
    TOGGLE_FULLSCREEN: 'toggle-fullscreen',
  });

  const GLOBAL_SHORTCUTS = Object.freeze([
    { accelerator: 'F9', action: ACTIONS.QUIT },
    { accelerator: 'Shift+9', action: ACTIONS.QUIT },
    { accelerator: 'F10', action: ACTIONS.TOGGLE_FULLSCREEN },
    { accelerator: 'Shift+0', action: ACTIONS.TOGGLE_FULLSCREEN },
  ]);

  function pressed(input, domName, electronName) {
    return Boolean(input && (input[domName] || input[electronName]));
  }

  function hasSystemModifier(input) {
    return pressed(input, 'ctrlKey', 'control') ||
      pressed(input, 'altKey', 'alt') ||
      pressed(input, 'metaKey', 'meta');
  }

  function hasOnlyShift(input) {
    return pressed(input, 'shiftKey', 'shift') && !hasSystemModifier(input);
  }

  function normalizedKey(input) {
    return String((input && input.key) || '').toUpperCase();
  }

  function isFunctionKey(input, key) {
    return normalizedKey(input) === key && !hasSystemModifier(input);
  }

  function isShiftDigit(input, digit, shiftedSymbol) {
    if (!hasOnlyShift(input)) return false;
    const key = String((input && input.key) || '');
    return input && (
      input.code === `Digit${digit}` ||
      key === String(digit) ||
      key === shiftedSymbol
    );
  }

  function getShortcutAction(input) {
    if (isFunctionKey(input, 'F9') || isShiftDigit(input, 9, '(')) {
      return ACTIONS.QUIT;
    }
    if (isFunctionKey(input, 'F10') || isShiftDigit(input, 0, ')')) {
      return ACTIONS.TOGGLE_FULLSCREEN;
    }
    return null;
  }

  function getAcceleratorsForAction(action) {
    return GLOBAL_SHORTCUTS
      .filter((shortcut) => shortcut.action === action)
      .map((shortcut) => shortcut.accelerator);
  }

  return Object.freeze({
    ACTIONS,
    GLOBAL_SHORTCUTS,
    getShortcutAction,
    getAcceleratorsForAction,
  });
});
