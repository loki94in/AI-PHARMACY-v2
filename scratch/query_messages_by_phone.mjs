import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

const targetPhones = [
  '919923777352@c.us',
  '919119455972@c.us',
  '919348492268@c.us',
  '918668519047@c.us'
];

try {
  for (const phone of targetPhones) {
    console.log(`\n========================================`);
    console.log(`CHAT HISTORY FOR: ${phone}`);
    console.log(`========================================`);
    
    const messages = db.prepare(`
      SELECT body, from_me, timestamp, type 
      FROM whatsapp_messages 
      WHERE chat_id = ? 
      ORDER BY timestamp DESC
      LIMIT 20
    `).all(phone);
    
    if (messages.length === 0) {
      console.log('(No messages found)');
      continue;
    }
    
    // Reverse to show in chronological order
    messages.reverse().forEach(msg => {
      let dateStr = 'unknown';
      try {
        const ts = Number(msg.timestamp);
        const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);
        dateStr = date.toISOString();
      } catch (_) {}
      
      console.log(`[${dateStr}] ${msg.from_me === 1 ? 'Me (Pharmacy)' : 'Customer'}: ${msg.body || '<Media/Image>'}`);
    });
  }
} catch (e) {
  console.error('Error querying database:', e.message);
} finally {
  db.close();
}
