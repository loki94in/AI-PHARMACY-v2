jest.mock('whatsapp-web.js', () => {
  const EventEmitter = require('events');
  class MockClient extends EventEmitter {
    initialize() {
      // Immediately emit ready for test
      this.emit('ready');
    }
    sendMessage = jest.fn();
  }
  const LocalAuth = jest.fn();
  return { Client: MockClient, LocalAuth };
});

const { initClient, sendMessage } = require('../../src/whatsappClient');

test('initClient resolves and sendMessage works after init', async () => {
  const client = await initClient();
  expect(client).toBeDefined();
  // sendMessage should be a mocked function
  await sendMessage('12345', 'path/to/media.jpg', 'caption');
  expect(client.sendMessage).toHaveBeenCalledWith('12345', { media: 'path/to/media.jpg', caption: 'caption' });
});
