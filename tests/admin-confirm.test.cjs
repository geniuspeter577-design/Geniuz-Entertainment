const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createConfirmAction } = require('../.test-build/src/utils/confirmAction.js');

test('web confirmation resolves with the browser decision and includes title and message', async () => {
  const prompts = [];
  const confirm = createConfirmAction({
    platform: 'web',
    webConfirm: (message) => {
      prompts.push(message);
      return true;
    },
    nativeAlert: () => assert.fail('Native alert should not be called on web.'),
  });

  assert.equal(await confirm('Delete title?', 'This permanently deletes the title.'), true);
  assert.deepEqual(prompts, ['Delete title?\n\nThis permanently deletes the title.']);

  const decline = createConfirmAction({
    platform: 'web',
    webConfirm: () => false,
    nativeAlert: () => assert.fail('Native alert should not be called on web.'),
  });
  assert.equal(await decline('Publish title?', 'Keep the title as a draft.'), false);
});

test('native confirmation resolves true or false from the selected action and dismissal', async () => {
  const alertCalls = [];
  const confirm = createConfirmAction({
    platform: 'ios',
    webConfirm: () => assert.fail('Browser confirm should not be called on native.'),
    nativeAlert: (...args) => alertCalls.push(args),
  });

  const accepted = confirm('Unpublish title?', 'Stop showing this title.', {
    confirmLabel: 'Unpublish',
    destructive: true,
  });
  const [title, message, buttons, options] = alertCalls[0];
  assert.equal(title, 'Unpublish title?');
  assert.equal(message, 'Stop showing this title.');
  assert.deepEqual(buttons.map(({ text, style }) => ({ text, style })), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unpublish', style: 'destructive' },
  ]);
  buttons[1].onPress();
  options.onDismiss();
  assert.equal(await accepted, true);

  const declined = confirm('Delete title?', 'Do not remove this title.');
  alertCalls[1][3].onDismiss();
  assert.equal(await declined, false);
});
