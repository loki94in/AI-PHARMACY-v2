import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

const targetLids = [
  '260090468774046@lid',
  '88961875746918@lid',
  '29884533469203@lid'
];

try {
  for (const lid of targetLids) {
    console.log(`\n========================================`);
    console.log(`LID CHAT: ${lid}`);
    console.log(`========================================`);
    
    const messages = db.prepare(`
      SELECT body, from_me, timestamp, type 
      FROM whatsapp_messages 
      WHERE chat_id = ? 
      ORDER BY timestamp ASC
    `).all(lid);
    
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
