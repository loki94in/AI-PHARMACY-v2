import { initClient } from '../../src/whatsappClient.js';

test('initClient should be defined', async () => {
  expect(typeof initClient).toBe('function');
  // Expect the promise to resolve to an object with sendMessage method
  const client = await initClient();
  expect(client).toHaveProperty('sendMessage');
  expect(typeof client.sendMessage).toBe('function');
});
