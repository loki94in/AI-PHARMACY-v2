import { initClient, sendMessage } from '../src/whatsappClient.js';
import { dbManager } from '../src/database/connection.js';
import path from 'path';

async function main() {
  const dbPath = path.resolve('data', 'app.db');
  process.env.DB_PATH = dbPath;

  console.log('Starting standalone WhatsApp client session...');
  
  let finished = false;

  // Set timeout to prevent hanging if authentication is needed (QR code is printed instead of ready)
  const timer = setTimeout(async () => {
    if (!finished) {
      console.log('❌ Timeout reached. Client is not authenticated or needs QR scan. Exiting.');
      process.exit(1);
    }
  }, 25000);

  try {
    const client = await initClient();
    finished = true;
    clearTimeout(timer);

    console.log('✅ Client connected successfully!');
    console.log('Sending test message to admin (8080888041)...');
    
    // We send to 8080888041
    await sendMessage('8080888041', undefined, 'Frontend and backend are working! - AI Pharmacy v2');
    console.log('✅ Message sent successfully!');

    // Wait a brief moment for the message to be transmitted before destroying client
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('Closing WhatsApp client...');
    await client.destroy();
    console.log('Done.');
  } catch (err) {
    console.error('❌ Error during message send:', err);
    process.exit(1);
  } finally {
    await dbManager.close(true);
  }
}

main();
