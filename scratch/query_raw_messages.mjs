import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

try {
  const messages = db.prepare(`
    SELECT id, chat_id, body, from_me, timestamp, type 
    FROM whatsapp_messages 
    ORDER BY timestamp DESC 
    LIMIT 15
  `).all();
  
  console.log('--- Raw Message Info ---');
  messages.forEach(msg => {
    console.log(`ID: ${msg.id}`);
    console.log(`Chat ID: ${msg.chat_id}`);
    console.log(`FromMe: ${msg.from_me}`);
    console.log(`Body snippet: ${msg.body ? msg.body.substring(0, 120) : '<empty>'}`);
    console.log('------------------------');
  });
} catch (e) {
  console.error('Error querying database:', e.message);
} finally {
  db.close();
}
