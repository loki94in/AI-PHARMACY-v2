import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { normalizeDistributorName, formatInvoiceWithFY } from './utils/migrationValidation.js';
import { fileURLToPath } from 'url';
import { dbManager } from './database/connection.js';
import { ensureSchema } from './database.js';
import { telegramPrescriptionService } from './services/telegramPrescriptionService.js';
import { aiCameraService } from './services/aiCameraService.js';
import { imageArchiveService } from './services/imageArchiveService.js';
import { notificationManager } from './utils/notifications.js';
import { extractDateFromText } from './utils/dateExtractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');

class TelegramBotService {
  private bot: TelegramBot | null = null;
  private token: string | undefined;
  private chatId: string | undefined;
  private enabled: boolean = false;
  private lang: string;

  constructor() {
    this.lang = process.env.TELEGRAM_LANG || 'en';
  }

  public async initializeOrReloadBot(): Promise<void> {
    try {
      const db = await dbManager.getConnection();
      
      // Load current settings from database
      const settings = await db.all(
        "SELECT key, value FROM app_settings WHERE key IN ('telegram_enabled', 'telegram_token', 'telegram_chat_id')"
      );
      const settingsMap = settings.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, string>);

      const nextEnabled = settingsMap['telegram_enabled'] === 'true';
      const nextToken = settingsMap['telegram_token'] || '';
      const nextChatId = settingsMap['telegram_chat_id'] || '';

      const tokenChanged = this.token !== nextToken;
      const enabledChanged = this.enabled !== nextEnabled;
      const chatIdChanged = this.chatId !== nextChatId;

      if (!tokenChanged && !enabledChanged && !chatIdChanged && this.bot) {
        // No changes, and bot is already running
        return;
      }

      console.log(`[Telegram] Configuration updated. enabled: ${nextEnabled}, token: ${nextToken ? '***' : 'empty'}, chat_id: ${nextChatId}`);

      // Shutdown active polling bot if running
      if (this.bot) {
        console.log('[Telegram] Stopping active bot polling...');
        try {
          if (this.bot.isPolling()) {
            await this.bot.stopPolling();
          }
        } catch (e) {
          console.error('[Telegram] Error stopping polling:', e);
        }
        this.bot = null;
      }

      this.token = nextToken;
      this.chatId = nextChatId;
      this.enabled = nextEnabled;

      if (!this.enabled || !this.token) {
        console.log('[Telegram] Bot is disabled or missing token. Polling inactive.');
        return;
      }

      console.log('[Telegram] Starting new bot polling client...');
      this.bot = new TelegramBot(this.token, { polling: true });
      this.setupCommandHandlers();
      this.setupErrorHandling();
      console.log('[Telegram] Bot initialized successfully.');
    } catch (error) {
      console.error('[Telegram] Failed to initialize or reload bot:', error);
    }
  }



  private setupCommandHandlers(): void {
    if (!this.bot) return;

    // Handle /start command
    this.bot.onText(/^\/?start/i, (msg) => {
      const chatId = msg.chat.id;
      this.bot?.sendMessage(chatId,
        'Welcome to AI Pharmacy Bot!\n\n' +
        'You can check medicine availability in two ways:\n' +
        '1. Use command: /check <medicine>\n' +
        '2. Just type the medicine name directly (e.g., paracetamol)\n\n' +
        'Other commands (you can type them with or without the /):\n' +
        'report - Get sales report\n' +
        'away summary - See what happened while you were away\n' +
        'help - Show help message\n' +
        'status - Check application status'
      );
    });

    // Handle /help command
    this.bot.onText(/^\/?help/i, (msg) => {
      const chatId = msg.chat.id;
      this.bot?.sendMessage(chatId,
        'AI Pharmacy Bot Usage:\n\n' +
        '1. Direct medicine name: Send just the medicine name (e.g., paracetamol)\n' +
        '2. Command format: Use /check <medicine> (e.g., /check paracetamol)\n' +
        '3. Send prescription image: Upload a photo of medicine prescription\n\n' +
        'Prescription commands:\n' +
        'viewcart - View your current cart\n' +
        'clearcart - Clear your cart\n' +
        'bill - Generate bill from cart\n\n' +
        'Both methods will show:\n' +
        '• Availability status\n' +
        '• MRP (price per unit)\n' +
        '• Quantity in stock\n' +
        '• Alternative medicine (if out of stock)\n\n' +
        'Other commands:\n' +
        'report weekly/monthly - Get business reports\n' +
        'away summary - See latest activity\n' +
        'help - Show this help message\n' +
        'status - Check application status'
      );
    });

    // Handle /check command for medicine availability
    this.bot.onText(/^\/?check (.+)/i, async (msg, match) => {
      const chatId = msg.chat.id;
      const medicineName = match ? match[1]?.toLowerCase().trim() : '';

      if (!medicineName) {
        this.bot?.sendMessage(chatId, 'Please provide a medicine name to check. Example: check paracetamol');
        return;
      }

      await this.handleMedicineQuery(chatId, medicineName);
    });

    // Handle /status command
    this.bot.onText(/^\/?status/i, async (msg) => {
      const chatId = msg.chat.id;
      try {
        const db = await dbManager.getConnection();
        const result = await db.get('SELECT COUNT(*) as total FROM medicines');
        
        this.bot?.sendMessage(chatId,
          `🤖 AI Pharmacy Bot Status: Online\n` +
          `📊 Database: Connected (${result.total} medicines registered)\n` +
          `⏰ Uptime: Running since startup\n` +
          `🔄 Polling: Active`
        );
      } catch (error) {
        console.error('Error checking bot status:', error);
        this.bot?.sendMessage(chatId, '❌ Bot Status: Error connecting to database');
      }
    });

    // Handle /stockalerts command
    this.bot.onText(/\/stockalerts/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        const db = await dbManager.getConnection();
        
        // Check current status
        const setting = await db.get("SELECT value FROM app_settings WHERE key = 'telegram_stock_alerts_enabled'");
        let currentStatus = setting ? setting.value === 'true' : true; // default to true
        let newStatus = !currentStatus;
        
        // Upsert setting
        await db.run(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_stock_alerts_enabled', ?)",
          [newStatus ? 'true' : 'false']
        );
        
                
        this.bot?.sendMessage(chatId,
          `🔔 *Telegram Stock Alerts:* ${newStatus ? 'ENABLED ✅' : 'DISABLED ❌'}\n\nYou will ${newStatus ? 'now' : 'no longer'} receive automated low-stock warnings.`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error toggling stock alerts:', error);
        this.bot?.sendMessage(chatId, '❌ Error toggling stock alerts settings.');
      }
    });

    // Handle /report command
    this.bot.onText(/^\/?report(?:\s+(weekly|monthly))?/i, async (msg, match) => {
      const chatId = msg.chat.id;
      const type = (match && match[1]) ? match[1].toLowerCase() : 'weekly';
      const days = type === 'monthly' ? 30 : 7;
      
      try {
        const db = await dbManager.getConnection();
        
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateStr = dateLimit.toISOString();

        const sales = await db.get(`SELECT SUM(total_amount) as total FROM sells WHERE date >= ?`, [dateStr]);
        const purchases = await db.get(`SELECT SUM(total_amount) as total FROM purchases WHERE date >= ?`, [dateStr]);
        
        
        const salesTotal = (sales?.total || 0).toFixed(2);
        const purchasesTotal = (purchases?.total || 0).toFixed(2);
        
        this.bot?.sendMessage(chatId,
          `📊 *${type.toUpperCase()} REPORT (Last ${days} days)*\n\n` +
          `📈 Total Sales: ₹${salesTotal}\n` +
          `📉 Total Purchases: ₹${purchasesTotal}\n\n` +
          `💡 *Net Difference:* ₹${(parseFloat(salesTotal) - parseFloat(purchasesTotal)).toFixed(2)}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error generating report:', error);
        this.bot?.sendMessage(chatId, '❌ Error generating report.');
      }
    });

    // Handle /away_summary command
    this.bot.onText(/^\/?(away_summary|away summary)/i, async (msg) => {
      const chatId = msg.chat.id;
      try {
        const db = await dbManager.getConnection();
        
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - 1);
        const dateStr = dateLimit.toISOString();

        const salesCount = await db.get(`SELECT COUNT(*) as count FROM sells WHERE date >= ?`, [dateStr]);
        const purchasesCount = await db.get(`SELECT COUNT(*) as count FROM purchases WHERE date >= ?`, [dateStr]);
        const lowStockCount = await db.get(`SELECT COUNT(*) as count FROM inventory_master WHERE quantity <= reorder_level`);
        
                
        this.bot?.sendMessage(chatId,
          `📝 *"While You Were Away" Summary (Last 24h)*\n\n` +
          `✅ Sales made: ${salesCount?.count || 0}\n` +
          `📦 Purchase orders: ${purchasesCount?.count || 0}\n` +
          `⚠️ Low stock alerts: ${lowStockCount?.count || 0} items currently below reorder level.\n\n` +
          `Welcome back!`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error generating away summary:', error);
        this.bot?.sendMessage(chatId, '❌ Error generating away summary.');
      }
    });

    // Handle /viewcart command
    this.bot.onText(/\/viewcart/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        const cartItems = telegramPrescriptionService.getCartItems(chatId);
        const { subtotal, tax, total } = telegramPrescriptionService.calculateCartTotal(chatId);

        if (cartItems.length === 0) {
          this.bot?.sendMessage(chatId, '🛒 Your cart is empty. Add medicines by sending prescription images or using /check command.');
          return;
        }

        let cartText = '🛒 *Your Cart:*\n\n';
        for (const item of cartItems) {
          cartText += `• ${item.medicine_name} x${item.quantity} = ₹${(item.quantity * item.unit_price).toFixed(2)}\n`;
        }
        cartText += `\n💰 *Subtotal:* ₹${subtotal.toFixed(2)}\n`;
        cartText += `🧾 *Tax (5%):* ₹${tax.toFixed(2)}\n`;
        cartText += `💵 *Total:* ₹${total.toFixed(2)}\n\n`;
        cartText += 'Use /bill to generate invoice or send more prescription images to add items.';

        this.bot?.sendMessage(chatId, cartText, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error viewing cart:', error);
        this.bot?.sendMessage(chatId, '❌ Error viewing cart. Please try again.');
      }
    });

    // Handle /clearcart command
    this.bot.onText(/\/clearcart/, async (msg) => {
      const chatId = msg.chat.id;
      telegramPrescriptionService.clearCart(chatId);
      this.bot?.sendMessage(chatId, '🗑️ Your cart has been cleared.');
    });

    // Handle /bill command
    this.bot.onText(/\/bill(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const paymentArg = match && match[1] ? match[1].toUpperCase().trim() : 'CASH';
      const paymentMedium = paymentArg === 'CREDIT' ? 'CREDIT' : 'CASH';

      try {
        const cartItems = telegramPrescriptionService.getCartItems(chatId);
        if (cartItems.length === 0) {
          this.bot?.sendMessage(chatId, '🛒 Your cart is empty. Add medicines by sending prescription images first.');
          return;
        }

        this.bot?.sendMessage(chatId, `🧾 Generating ${paymentMedium} bill from your cart...`);

        // Make internal API call to generate bill
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default || fetchModule;
        const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/telegram-prescription/bill/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chatId: chatId,
            patient_id: null,
            doctor_id: null,
            discount: 0,
            payment_medium: paymentMedium
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to generate bill: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
          this.bot?.sendMessage(chatId,
            `✅ *Bill Generated Successfully! (${paymentMedium})*\n\n` +
            `📄 Invoice No: ${result.invoice_no}\n` +
            `💰 Total Amount: ₹${result.total.toFixed(2)}\n` +
            `🧾 Tax Amount: ₹${result.tax.toFixed(2)}\n\n` +
            (paymentMedium === 'CREDIT' ? `💬 Stamped bill sent to your WhatsApp number.` : `Thank you for using AI Pharmacy!`),
            { parse_mode: 'Markdown' }
          );
        } else {
          this.bot?.sendMessage(chatId, `❌ Failed to generate bill: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error generating bill:', error);
        this.bot?.sendMessage(chatId, '❌ Error generating bill. Please try again or contact support.');
      }
    });

    // Handle direct medicine name messages (without / prefix)
    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const messageText = msg.text?.trim();

      // Ignore empty messages
      if (!messageText) {
        return;
      }

      // If message starts with '/', treat as command (handled by onText handlers)
      if (messageText.startsWith('/')) {
        // Let the onText handlers process commands
        return;
      }

      // Ignore known commands so they don't trigger medicine search
      if (messageText.match(/^(report|away_summary|away summary|viewcart|clearcart|bill|help|status|check|start)/i)) {
        return;
      }

      // Treat direct messages as medicine name queries
      this.handleMedicineQuery(chatId, messageText);
    });

    // Handle photo messages (prescription images)
    this.bot.on('photo', async (msg) => {
      const chatId = msg.chat.id;

      // Send processing message
      this.bot?.sendMessage(chatId, '📥 Image received. Processing prescription...')
        .then(() => {
          // Get the highest resolution photo
          if (!msg.photo || msg.photo.length === 0) return;
          const photo = msg.photo.reduce((prev, current) =>
            ((prev.file_size || 0) > (current.file_size || 0)) ? prev : current
          );

          // Download and process the photo
          this.bot?.getFileLink(photo.file_id)
            .then(async (fileLink) => {
              try {
                // Fetch the image data
                const response = await fetch(fileLink);
                if (!response.ok) {
                  throw new Error(`Failed to download image: ${response.status}`);
                }
                const imageBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(imageBuffer);

                // Save to temp folder for archiving/cleanup
                const tempFileName = `telegram_${Date.now()}_${msg.from?.id}.jpg`;
                const tempFilePath = path.join(__dirname, '..', 'uploads', 'temp', tempFileName);
                fs.writeFileSync(tempFilePath, buffer);

                // Route through AI archiving service
                await imageArchiveService.processAndRouteImage(tempFilePath);

                // Process with AI camera service
                const result = await aiCameraService.processImage(buffer);

                // Determine if it is a bill/invoice photo
                const captionText = (msg.caption || '').toLowerCase();
                const ocrTextLower = (result.text || '').toLowerCase();
                const isBill = captionText.includes('bill') || captionText.includes('invoice') || captionText.includes('purchase') ||
                               ocrTextLower.includes('invoice') || ocrTextLower.includes('bill no') || ocrTextLower.includes('mrp') || ocrTextLower.includes('tax invoice');

                if (isBill) {
                  this.bot?.sendMessage(chatId, '📄 Invoice detected. Processing items into inventory...');
                  
                  const medicines: Array<{ name: string; quantity: number }> = [];
                  const lines = (result.text || '').split('\n');
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    const qtyMatch = trimmed.match(/(?:(?:qty|quantity|x|count)\s*[:\-\s]*\s*(\d+))|(\d+)\s*(?:x|units|pcs)/i);
                    if (qtyMatch) {
                      const qty = parseInt(qtyMatch[1] || qtyMatch[2]) || 10;
                      let name = trimmed.replace(qtyMatch[0], '').replace(/[:\-\t\r\n]/g, ' ').trim();
                      if (name && name.length > 3 && isNaN(Number(name))) {
                        medicines.push({ name, quantity: qty });
                      }
                    }
                  }

                  if (medicines.length === 0) {
                    const potentialName = result.medicineInfo?.potentialName || 'Unknown Product';
                    medicines.push({ name: potentialName, quantity: 10 });
                  }

                  const db = await dbManager.getConnection();
                  
                  let distributorName = 'TELEGRAM IMPORT';
                  const distMatch = ocrTextLower.match(/(nitin agency|cipla|alkem|abbott|cadila|zydus|intas|lupin)/i);
                  if (distMatch) {
                    distributorName = distMatch[1].toUpperCase();
                  }

                  const normName = normalizeDistributorName(distributorName);
                  let dist = await db.get(`SELECT id FROM distributors WHERE REPLACE(UPPER(name), ' ', '') LIKE ? LIMIT 1`, [`%${normName}%`]);
                  
                  if (!dist) {
                    await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distributorName]);
                    dist = await db.get('SELECT id FROM distributors WHERE name = ?', [distributorName]);
                  }
                  
                  const rawInvoiceNo = 'TG-INV-' + Date.now().toString().slice(-4);
                  let billDate = new Date().toISOString();
                  const extractedDate = extractDateFromText(result.text || '');
                  if (extractedDate) {
                    billDate = extractedDate;
                  }
                  
                  const invoiceNo = formatInvoiceWithFY(rawInvoiceNo, billDate);
                  
                  const purchaseResult = await db.run(
                    'INSERT INTO purchases (distributor_id, invoice_no, total_amount, date, business_date) VALUES (?, ?, ?, ?, ?)',
                    [dist.id, invoiceNo, 100 * medicines.length, billDate, billDate]
                  );
                  const purchaseId = purchaseResult.lastID;

                  let importDetails = '';
                  for (const item of medicines) {
                    let med = await db.get('SELECT id FROM medicines WHERE name LIKE ? LIMIT 1', [`%${item.name}%`]);
                    if (!med) {
                      const medResult = await db.run('INSERT INTO medicines (name) VALUES (?)', [item.name]);
                      med = { id: medResult.lastID };
                    }
                    
                    await db.run(
                      'INSERT INTO purchase_items (purchase_id, medicine_id, quantity, cost_price, mrp) VALUES (?, ?, ?, ?, ?)',
                      [purchaseId, med.id, item.quantity, 10, 15]
                    );

                    const existingInv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? LIMIT 1', [med.id]);
                    if (existingInv) {
                      await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [item.quantity, existingInv.id]);
                    } else {
                      await db.run(
                        'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, unit_price, cost_price, reorder_level, mrp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [med.id, item.quantity, 'B-TG-' + Date.now().toString().slice(-4), '2028-12-31', 10, 8, 10, 15]
                      );
                    }
                    importDetails += `• ${item.name} x${item.quantity}\n`;
                  }

                  await db.run(
                    'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
                    ['TELEGRAM_BILL_IMPORTED', `Imported invoice ${invoiceNo} from distributor ${distributorName}`]
                  );
                  
                  notificationManager.broadcast({
                    type: 'telegram_bill',
                    title: 'Telegram Bill Processed',
                    message: `Imported invoice ${invoiceNo} from ${distributorName}.`,
                    distributorName,
                    invoiceNo,
                    timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
                  });

                  this.bot?.sendMessage(chatId, 
                    `✅ *Invoice Manually Imported!*\n` +
                    `📦 Distributor: ${distributorName}\n` +
                    `📄 Invoice No: ${invoiceNo}\n\n` +
                    `*Added to Inventory:*\n${importDetails}`,
                    { parse_mode: 'Markdown' }
                  );
                } else {
                  await telegramPrescriptionService.handlePrescriptionResult(
                    chatId,
                    result,
                    msg.caption || '',
                    this.bot!
                  );
                }

                // Send feedback messages based on result
                // Note: The actual messaging is handled within the prescription service now
              } catch (error) {
                console.error('Error processing prescription image:', error);
                this.bot?.sendMessage(chatId,
                  '❌ Error processing prescription image. Please try again or send a clearer image.'
                );
              }
            })
            .catch(downloadError => {
              console.error('Error downloading image:', downloadError);
              this.bot?.sendMessage(chatId,
                '❌ Failed to download image. Please try again.'
              );
            });
        })
        .catch(sendError => {
          console.error('Error sending processing message:', sendError);
        });
    });
  }

  private setupErrorHandling(): void {
    if (!this.bot) return;

    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error);
    });

    this.bot.on('error', (error) => {
      console.error('Telegram bot error:', error);
    });
  }

  // Method to send notifications to users
  public async sendNotification(chatId: string | number, message: string): Promise<boolean> {
    if (!this.bot) {
      console.error('Telegram bot not initialized');
      return false;
    }

    try {
      await this.bot.sendMessage(chatId, message);
      return true;
    } catch (error) {
      console.error('Failed to send Telegram notification:', error);
      return false;
    }
  }

  // Method to send notification to default chat (if configured)
  public async sendDefaultNotification(message: string): Promise<boolean> {
    const defaultChatId = this.chatId || process.env.TELEGRAM_CHAT_ID;
    if (defaultChatId) {
      return this.sendNotification(defaultChatId, message);
    }
    console.warn('Telegram Chat ID not configured for default notifications');
    return false;
  }

  // Email Notification Bridge
  public async sendEmailAlertToTelegram(emailSubject: string, emailSender: string, emailPreview: string): Promise<boolean> {
    const message = `📧 *New Important Email*\n\n*From:* ${emailSender}\n*Subject:* ${emailSubject}\n\n*Preview:* ${emailPreview}\n\nPlease check your email dashboard for details.`;
    return this.sendDefaultNotification(message);
  }

  // Method to send a photo to the default chat
  public async sendPhotoToDefaultChat(photoBuffer: Buffer, caption: string): Promise<boolean> {
    const defaultChatId = this.chatId || process.env.TELEGRAM_CHAT_ID;
    if (defaultChatId && this.bot) {
      try {
        await this.bot.sendPhoto(defaultChatId, photoBuffer, { caption });
        return true;
      } catch (error) {
        console.error('Failed to send Telegram photo:', error);
      }
    } else {
      console.warn('Telegram Chat ID not configured or bot not initialized for photo notifications');
    }
    return false;
  }

  // Method to broadcast message to multiple chats (if needed)
  public async broadcastMessage(chatIds: (string | number)[], message: string): Promise<number> {
    if (!this.bot) {
      console.error('Telegram bot not initialized');
      return 0;
    }

    let sentCount = 0;
    for (const chatId of chatIds) {
      try {
        await this.bot.sendMessage(chatId, message);
        sentCount++;
      } catch (error) {
        console.error(`Failed to send message to chat ${chatId}:`, error);
      }
    }
    return sentCount;
  }

  // Query medicine availability from inventory
  private async handleMedicineQuery(chatId: number, medicineName: string): Promise<void> {
    try {
      const db = await dbManager.getConnection();
      const medicine = await db.get(
        `SELECT m.id, m.name, m.item_type, m.mrp as m_mrp, im.quantity, im.mrp as i_mrp 
         FROM medicines m
         LEFT JOIN inventory_master im ON im.medicine_id = m.id
         WHERE LOWER(m.name) LIKE ?
         ORDER BY im.quantity DESC LIMIT 1`,
        [`%${medicineName.toLowerCase()}%`]
      );

      if (!medicine) {
        this.bot?.sendMessage(chatId, `❌ Medicine "${medicineName}" not found in our system.`);
                return;
      }

      const mrp = medicine.i_mrp || medicine.m_mrp || 'N/A';
      const category = medicine.item_type || 'General';

      if ((medicine.quantity ?? 0) > 0) {
        this.bot?.sendMessage(
          chatId,
          `✅ *${medicine.name}*\n🏷️ Category: ${category}\n📦 Stock: ${medicine.quantity} units\n💰 MRP: ₹${mrp}\n\nAvailable at the pharmacy.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        let msg = `⚠️ *${medicine.name}* is currently OUT OF STOCK.\n🏷️ Category: ${category}\n💰 MRP: ₹${mrp}\n\n`;
        
        // Find alternatives based on item_type/category
        if (medicine.item_type) {
          const alternatives = await db.all(
            `SELECT m.name, im.quantity, im.mrp 
             FROM medicines m
             JOIN inventory_master im ON im.medicine_id = m.id
             WHERE m.item_type = ? AND m.id != ? AND im.quantity > 0
             ORDER BY im.quantity DESC LIMIT 2`,
            [medicine.item_type, medicine.id]
          );

          if (alternatives && alternatives.length > 0) {
            msg += `*Recommended Alternatives (In Stock):*\n`;
            for (const alt of alternatives) {
              msg += `• *${alt.name}* (Stock: ${alt.quantity} units) - MRP: ₹${alt.mrp}\n`;
            }
          } else {
            msg += `No in-stock alternatives found for category ${category}.`;
          }
        }
        
        this.bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      }
          } catch (error) {
      console.error('handleMedicineQuery error:', error);
      this.bot?.sendMessage(chatId, '❌ Error looking up medicine. Please try again.');
    }
  }

  // Graceful shutdown
  public async shutdown(): Promise<void> {
    if (this.bot) {
      console.log('Telegram bot shutting down...');
      try {
        if (this.bot.isPolling()) {
          await this.bot.stopPolling();
        }
      } catch (e) {
        console.error('[Telegram] Error stopping polling during shutdown:', e);
      }
      this.bot = null;
    }
  }
}

// Export singleton instance
export const telegramBotService = new TelegramBotService();
export default telegramBotService;