// Telegram Prescription Service for managing prescription-to-cart workflow
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { aiCameraService } from './aiCameraService.js';
import { productNameFilterService } from './productNameFilterService.js';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

// Cart item interface
interface CartItem {
  inventory_id: number;
  medicine_name: string;
  quantity: number;
  unit_price: number;
  strength?: string;
  batch_number?: string;
  expiry_date?: string | null;
}

// Cart interface
interface UserCart {
  chatId: number;
  items: CartItem[];
  createdAt: Date;
  updatedAt: Date;
}

// In-memory storage for carts (with plans to move to persistent storage)
// TODO: Replace with database/persistent storage as per plan
const carts = new Map<number, UserCart>();

class TelegramPrescriptionService {
  private readonly CART_EXPIRY_HOURS = 24; // Cart expires after 24 hours

  constructor() {
    // Start cleanup interval for expired carts
    setInterval(() => this.cleanupExpiredCarts(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Get or create cart for a chat
   */
  private getOrCreateCart(chatId: number): UserCart {
    const existingCart = carts.get(chatId);
    if (existingCart) {
      // Update timestamp
      existingCart.updatedAt = new Date();
      return existingCart;
    }

    const newCart: UserCart = {
      chatId,
      items: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    carts.set(chatId, newCart);
    return newCart;
  }

  /**
   * Get cart for a chat
   */
  private getCart(chatId: number): UserCart | undefined {
    return carts.get(chatId);
  }

  /**
   * Save cart (placeholder for future persistent storage)
   */
  private async saveCart(cart: UserCart): Promise<void> {
    // TODO: Implement persistent storage (database or file)
    // For now, we keep in memory but this function prepares for future persistence
    carts.set(cart.chatId, cart);
  }

  /**
   * Clean up expired carts
   */
  private cleanupExpiredCarts(): void {
    const now = new Date();
    const expiryTime = now.getTime() - (this.CART_EXPIRY_HOURS * 60 * 60 * 1000);

    for (const [chatId, cart] of carts.entries()) {
      if (cart.updatedAt.getTime() < expiryTime) {
        carts.delete(chatId);
        console.log(`Cleaned up expired cart for chat ${chatId}`);
      }
    }
  }

  /**
   * Extract quantity from prescription text using regex patterns
   */
  private extractQuantityFromText(text: string): number | null {
    // Patterns for quantities like "2x", "2 x", "2 tablets", etc.
    const patterns = [
      /(\d+)\s*x/i,                    // "2x"
      /(\d+)\s*tablet/i,               // "2 tablet"
      /(\d+)\s*capsule/i,              // "2 capsule"
      /(\d+)\s*strip/i,                // "2 strip"
      /(\d+)\s*bottle/i,               // "2 bottle"
      /(\d+)\s*pack/i,                 // "2 pack"
      /^(\d+)\s*/                      // Leading number (fallback)
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const quantity = parseInt(match[1], 10);
        if (!isNaN(quantity) && quantity > 0) {
          return quantity;
        }
      }
    }

    return null; // No quantity found
  }

  /**
   * Process AI camera result and update cart
   */
  async handlePrescriptionResult(chatId: number, result: any, caption: string = '', bot: TelegramBot): Promise<void> {
    try {
      // Get or create cart for this chat
      const cart = this.getOrCreateCart(chatId);

      // Extract medicine info from result
      const medicineInfo = result.medicineInfo || {};
      const potentialName = medicineInfo.potentialName;
      const strength = medicineInfo.strength || '';
      const batchNumber = medicineInfo.batchNumber || '';
      const expiryDate = medicineInfo.expiryDate || null;
      const mrp = medicineInfo.mrp || 0;

      if (!potentialName || potentialName.trim() === '') {
        // No medicine detected, send to audit queue for review
        await this.sendNoMedicineDetectedMessage(chatId, bot);
        return;
      }

      // Look up medicine in database
      const medicineId = await this.findMedicineIdByName(potentialName.trim());
      if (!medicineId) {
        // Medicine not found in database
        await this.sendMedicineNotFoundMessage(chatId, potentialName.trim(), bot);
        return;
      }

      // Get inventory details for this medicine
      const inventoryDetails = await this.getInventoryDetails(medicineId);
      if (!inventoryDetails) {
        // No inventory found for this medicine
        await this.sendNoInventoryMessage(chatId, potentialName.trim(), bot);
        return;
      }

      // Determine quantity
      let quantity = 1; // Default quantity

      // Try to extract quantity from caption or OCR text
      const textToCheck = caption || result.text || '';
      const extractedQuantity = this.extractQuantityFromText(textToCheck);
      if (extractedQuantity !== null) {
        quantity = extractedQuantity;
      }

      // Check if we have enough stock
      if (inventoryDetails.quantity < quantity) {
        await this.sendInsufficientStockMessage(chatId, potentialName.trim(), inventoryDetails.quantity, bot);
        return;
      }

      // Check if item already in cart
      const existingItemIndex = cart.items.findIndex(
        item => item.inventory_id === inventoryDetails.id
      );

      if (existingItemIndex >= 0) {
        // Increase quantity of existing item
        cart.items[existingItemIndex].quantity += quantity;
      } else {
        // Add new item to cart
        cart.items.push({
          inventory_id: inventoryDetails.id,
          medicine_name: potentialName.trim(),
          quantity,
          unit_price: parseFloat(inventoryDetails.mrp || '0'),
          strength,
          batch_number: batchNumber || inventoryDetails.batch_number || '',
          expiry_date: expiryDate || inventoryDetails.expiry_date || null
        });
      }

      // Update cart timestamp
      cart.updatedAt = new Date();

      // Save cart
      await this.saveCart(cart);

      // Send confirmation message
      await this.sendPrescriptionProcessedMessage(chatId, potentialName.trim(), quantity, cart.items.length, bot);
    } catch (error) {
      console.error('Error handling prescription result:', error);
      // Send error message to user
      if (bot) {
        await bot.sendMessage(chatId, '❌ Error processing prescription. Please try again.');
      }
    }
  }

  /**
   * Find medicine ID by name (fuzzy matching)
   */
  private async findMedicineIdByName(name: string): Promise<number | null> {
    try {
      const db = await dbManager.getConnection();

      // First try exact match
      const exactMatch = await db.get(
        'SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)',
        [name]
      );

      if (exactMatch) {
                return exactMatch.id;
      }

      // Try fuzzy match using product name filter service
      const filterResult = await productNameFilterService.filterProductNames(name, {
        minConfidenceThreshold: 0.7
      });

      if (filterResult.matches.length > 0) {
        // Get the best match
        const bestMatch = filterResult.matches[0];
        const medicine = await db.get(
          'SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)',
          [bestMatch]
        );

                return medicine ? medicine.id : null;
      }

            return null;
    } catch (error) {
      console.error('Error finding medicine ID:', error);
      return null;
    }
  }

  /**
   * Get inventory details for a medicine ID
   */
  private async getInventoryDetails(medicineId: number): Promise<any> {
    try {
      const db = await dbManager.getConnection();

      const inventory = await db.get(
        `SELECT im.id, im.quantity, im.mrp, im.batch_number, im.expiry_date
         FROM inventory_master im
         WHERE im.medicine_id = ? AND im.quantity > 0
         ORDER BY im.quantity DESC LIMIT 1`,
        [medicineId]
      );

            return inventory;
    } catch (error) {
      console.error('Error getting inventory details:', error);
      return null;
    }
  }

  /**
   * Add item to cart manually (for testing or direct addition)
   */
  async addItemToCart(chatId: number, medicineName: string, quantity: number = 1): Promise<boolean> {
    try {
      const cart = this.getOrCreateCart(chatId);

      // Find medicine
      const medicineId = await this.findMedicineIdByName(medicineName);
      if (!medicineId) {
        return false;
      }

      // Get inventory
      const inventoryDetails = await this.getInventoryDetails(medicineId);
      if (!inventoryDetails || inventoryDetails.quantity < quantity) {
        return false;
      }

      // Check if item already in cart
      const existingItemIndex = cart.items.findIndex(
        item => item.inventory_id === inventoryDetails.id
      );

      if (existingItemIndex >= 0) {
        cart.items[existingItemIndex].quantity += quantity;
      } else {
        cart.items.push({
          inventory_id: inventoryDetails.id,
          medicine_name: medicineName,
          quantity,
          unit_price: parseFloat(inventoryDetails.mrp || '0'),
          strength: '',
          batch_number: inventoryDetails.batch_number || '',
          expiry_date: inventoryDetails.expiry_date || null
        });
      }

      cart.updatedAt = new Date();
      await this.saveCart(cart);
      return true;
    } catch (error) {
      console.error('Error adding item to cart:', error);
      return false;
    }
  }

  /**
   * Get cart for a chat
   */
  getCartItems(chatId: number): any[] {
    const cart = this.getCart(chatId);
    return cart ? cart.items : [];
  }

  /**
   * Clear cart for a chat
   */
  clearCart(chatId: number): void {
    carts.delete(chatId);
  }

  /**
   * Calculate cart total
   */
  calculateCartTotal(chatId: number): { subtotal: number, tax: number, total: number, items: any[] } {
    const cart = this.getCart(chatId);
    if (!cart || cart.items.length === 0) {
      return { subtotal: 0, tax: 0, total: 0, items: [] };
    }

    let subtotal = 0;
    for (const item of cart.items) {
      subtotal += item.quantity * item.unit_price;
    }

    const taxRate = 0.05; // 5% tax
    const total = Math.round(subtotal);
    const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));

    return {
      subtotal,
      tax,
      total,
      items: cart.items
    };
  }

  // Message sending helpers (these will be called from telegramBot.ts)
  async sendNoMedicineDetectedMessage(chatId: number, bot: TelegramBot): Promise<void> {
    await bot.sendMessage(chatId, '❌ No medicine detected in the image. Please try again with a clearer image of the medicine packaging.');
  }

  async sendMedicineNotFoundMessage(chatId: number, medicineName: string, bot: TelegramBot): Promise<void> {
    await bot.sendMessage(chatId, `❌ Medicine "${medicineName}" not found in our system. Please check the spelling or contact the pharmacy.`);
  }

  async sendNoInventoryMessage(chatId: number, medicineName: string, bot: TelegramBot): Promise<void> {
    await bot.sendMessage(chatId, `⚠️ Medicine "${medicineName}" is found in our system but currently out of stock.`);
  }

  async sendInsufficientStockMessage(chatId: number, medicineName: string, available: number, bot: TelegramBot): Promise<void> {
    await bot.sendMessage(chatId, `⚠️ Insufficient stock for "${medicineName}". Only ${available} units available.`);
  }

  async sendPrescriptionProcessedMessage(chatId: number, medicineName: string, quantity: number, cartSize: number, bot: TelegramBot): Promise<void> {
    await bot.sendMessage(chatId, `✅ Added ${quantity} unit(s) of "${medicineName}" to your cart.\\n🛒 Cart now contains ${cartSize} item(s). Use /viewcart to see your cart or /bill to generate an invoice.`);
  }
}

export const telegramPrescriptionService = new TelegramPrescriptionService();
export default telegramPrescriptionService;