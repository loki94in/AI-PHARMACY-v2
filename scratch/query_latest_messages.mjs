import Database from 'better-sqlite3';

const db = new Database('./data/app.db', { readonly: true, fileMustExist: true });

try {
  // Query messages containing keywords
  const keywordMessages = db.prepare(`
    SELECT id, body, from_me, timestamp, type 
    FROM whatsapp_messages 
    WHERE body LIKE '%medicine%' 
       OR body LIKE '%prescription%' 
       OR body LIKE '%stock%' 
       OR body LIKE '%pharm%'
       OR body LIKE '%वैद्यकीय%'
       OR body LIKE '%औषध%'
    ORDER BY timestamp DESC 
    LIMIT 15
  `).all();
  
  console.log('--- Medicine-Related WhatsApp Messages ---');
  keywordMessages.forEach(msg => {
    let dateStr = 'unknown';
    try {
      const ts = Number(msg.timestamp);
      const date = ts > 1000000000000 ? new Date(ts) : new Date(ts * 1000);
      dateStr = date.toISOString();
    } catch (_) {}
    
    console.log(`[${dateStr}] FromMe: ${msg.from_me === 1 ? 'Yes' : 'No'} | Type: ${msg.type}`);
    console.log(`Body: ${msg.body ? msg.body.substring(0, 150) : '<empty>'}`);
    console.log('------------------------');
  });
} catch (e) {
  console.error('Error querying database:', e.message);
} finally {
  db.close();
}
