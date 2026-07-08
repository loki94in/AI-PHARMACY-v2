import axios from 'axios';
import fs from 'fs';
import path from 'path';

async function main() {
  const chatId = '265046877806598@lid';
  const messageId = 'false_265046877806598@lid_A53C987F2DB2CE952646853CCE30DBF7';
  
  console.log(`Downloading media for Chat: ${chatId}, Message: ${messageId}`);
  
  try {
    const res = await axios.get(`http://127.0.0.1:3000/api/messaging/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/media`);
    const media = res.data;
    
    if (media && media.data) {
      const buffer = Buffer.from(media.data, 'base64');
      const outputPath = path.resolve('C:/Users/ratna/.gemini/antigravity-ide/brain/4222bcf2-f3ad-4658-9929-9e5978bf0e8a/customer_prescription.jpg');
      fs.writeFileSync(outputPath, buffer);
      console.log(`Successfully saved media to ${outputPath}`);
    } else {
      console.log("No media data returned in response:", media);
    }
  } catch (err) {
    console.error("Failed to download media via API:", err.message);
  }
}

main();
