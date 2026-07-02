const { initClient } = require('../../src/whatsappClient');

test('initClient should be defined', async () => {
  expect(typeof initClient).toBe('function');
  const client = await initClient();
  expect(client).toHaveProperty('sendMessage');
  expect(typeof client.sendMessage).toBe('function');
});
