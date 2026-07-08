import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

try {
  // Let's get the active chat IDs from today
  const activeChats = db.prepare(`
    SELECT DISTINCT chat_id 
    FROM whatsapp_messages 
    WHERE timestamp >= strftime('%s', '2026-07-08')
    LIMIT 10
  `).all();
  
  console.log('--- Active Chats Today ---');
  console.log(activeChats.map(c => c.chat_id));
  
  for (const chat of activeChats) {
    const chatId = chat.chat_id;
    console.log(`\n========================================`);
    console.log(`CHAT HISTORY FOR: ${chatId}`);
    console.log(`========================================`);
    
    const messages = db.prepare(`
      SELECT body, from_me, timestamp, type 
      FROM whatsapp_messages 
      WHERE chat_id = ? 
      ORDER BY timestamp ASC
    `).all(chatId);
    
    messages.forEach(msg => {
      let dateStr = 'unknown';
      try {
        const ts = Number(msg.timestamp);
        const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);
        dateStr = date.toLocaleString();
      } catch (_) {}
      
      console.log(`[${dateStr}] ${msg.from_me === 1 ? 'Me (Pharmacy)' : 'Customer'}: ${msg.body || '<Media>'}`);
    });
  }
} catch (e) {
  console.error('Error querying database:', e.message);
} finally {
  db.close();
}
