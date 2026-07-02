jest.mock('whatsapp-web.js', () => {
  const EventEmitter = require('events');
  class MockClient extends EventEmitter {
    initialize() {
      this.emit('ready');
    }
    sendMessage = jest.fn();
  }
  const LocalAuth = jest.fn();
  return { Client: MockClient, LocalAuth };
});

import { initClient, sendMessage } from '../../src/whatsappClient.js';

test('initClient resolves and sendMessage works after init', async () => {
  const client = await initClient();
  expect(client).toBeDefined();
  await sendMessage('12345', 'path/to/media.jpg', 'caption');
  expect((client as any).sendMessage).toHaveBeenCalledWith('12345', { media: 'path/to.media.jpg', caption: 'caption' });
});
