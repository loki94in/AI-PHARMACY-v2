import axios from 'axios';

async function main() {
  const chatId = '265046877806598@lid';
  const messageId = 'false_265046877806598@lid_A53C987F2DB2CE952646853CCE30DBF7';
  
  console.log(`Triggering manual scan for Chat: ${chatId}, Message: ${messageId}`);
  
  try {
    const res = await axios.post(`http://127.0.0.1:3000/api/messaging/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/scan`);
    console.log("Response status:", res.status);
    console.log("Response data:", res.data);
  } catch (err) {
    console.error("Failed to trigger scan via API:", err.message);
    if (err.response) {
      console.error("Response error data:", err.response.data);
    }
  }
}

main();
