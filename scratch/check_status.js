import axios from 'axios';

async function main() {
  try {
    const res = await axios.get('http://127.0.0.1:3000/api/messaging/qr');
    console.log("WhatsApp Status Response:", res.data);
  } catch (err) {
    console.error("Failed to fetch WhatsApp status:", err.message);
  }
}

main();
