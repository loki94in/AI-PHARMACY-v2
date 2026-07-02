# Email-Triggered WhatsApp & Telegram Notifications Design for AI Pharmacy

## Overview
This document outlines the design for automatically sending WhatsApp and Telegram notifications to delivery boys when order-related emails arrive in the pharmacy's email inbox. The system will monitor incoming emails, identify order-related content, and trigger notifications with distributor and delivery information.

## Requirements
- Monitor email inbox for new/unseen emails using existing IMAP polling
- Filter and identify order-related emails from mixed email types
- Extract order details including distributor information, medicines needed, and delivery instructions
- Send formatted notifications to delivery boys via WhatsApp and Telegram
- Include full order information with distributor pickup details and pharmacy delivery address
- Make notifications noticeable and attention-grabbing (popup-style alerts)
- Integrate with existing EmailService, WhatsApp client, and Telegram bot
- Maintain detailed logging of processed emails and sent notifications

## Architecture

### Components
1. **EmailService** (enhanced): Existing email polling service with added order detection and notification triggering
2. **WhatsApp Client** (existing): Used to send notifications to delivery boys
3. **TelegramBotService** (existing): Used to send notifications to delivery boys/managers
4. **Order Processing Logic**: New functionality to parse emails and extract order/distributor details
5. **Notification Formatter**: Creates standardized, attention-grabbing messages for WhatsApp and Telegram

### Data Flow
1. EmailService polls IMAP inbox for unseen emails (every 5 minutes)
2. For each unseen email:
   - Parse email content (subject, body, attachments)
   - Apply filtering logic to identify order-related emails
   - Extract key information: distributor name, contact, medicines, quantities, delivery address
   - Format notification message for WhatsApp and Telegram (designed to be noticeable)
   - Send notifications via WhatsApp client and Telegram bot
   - Log processed email and notification status to database
   - Mark email as seen to prevent reprocessing

## Detailed Design

### Email Processing Enhancement
Extend the existing `EmailService.processEmail()` method to:
1. Detect order-related emails using keyword matching and pattern recognition
2. Parse email content to extract structured order data:
   - Distributor name and contact information
   - List of medicines with quantities (based on Nitin Agency sample format)
   - Delivery address (pharmacy location)
   - Pickup instructions/time windows
3. Create notification content using extracted data, designed to be noticeable

### Notification Content Structure
For order-related emails, notifications will include attention-grabbing elements:
```
🚨🚨🚨 NEW ORDER ALERT 🚨🚨🚨

📦 ORDER DETAILS:
• Medicines: [List of medicines with quantities]
• Total Items: [Count]
• Urgency: [Normal/High based on email content]

🏭 PICKUP INFORMATION:
• From: [Distributor Name] ⭐
• Contact: [Distributor Phone]
• Address: [Distributor Address]
• Pickup Window: [Time if specified]

🏥 DELIVERY INFORMATION:
• To: [Pharmacy Name/Address]
• Contact: [Pharmacy Phone]
• Address: [Pharmacy Address]

📅 TIMESTAMPS:
• Order Received: [Current timestamp]
• Action Required: Collect & deliver within [timeframe if specified]

💡 INSTRUCTIONS:
Please collect the above medicines from the distributor and deliver to our pharmacy.
Reply "DONE" upon completion.
```

### Integration Points
1. **EmailService**: 
   - Enhance `processEmail()` method to detect and handle order emails
   - Add new methods: `extractOrderInfo()`, `formatDeliveryNotification()`
   - Add WhatsApp/Telegram notification sending capabilities
   - Focus on creating attention-grabbing, noticeable notification content

2. **WhatsApp Integration**:
   - Use existing `sendMessage()` function from `whatsappClient.ts`
   - Format messages with emojis, spacing, and clear sections for visibility

3. **Telegram Integration**:
   - Use existing `TelegramBotService.sendNotification()` method
   - Send to pre-configured delivery boy/group chat IDs
   - Use formatting options available in Telegram for better visibility

4. **Database Logging**:
   - Extend existing `action_logs` table usage or create new table for email notifications
   - Log: email ID, sender, subject, processing timestamp, notification status

### Security & Error Handling
1. **Authentication**:
   - Uses existing IMAP/SMTP credentials from environment variables
   - WhatsApp uses existing LocalAuth mechanism
   - Telegram uses existing bot token

2. **Error Handling**:
   - Email parsing failures: Log error, continue processing other emails
   - WhatsApp/Telegram send failures: Retry mechanism, log failed notifications
   - Missing information: Send partial notification with available data
   - Duplicate processing: Prevented by marking emails as seen

3. **Validation**:
   - Validate extracted data before sending notifications
   - Fallback to raw email content if structured parsing fails
   - Rate limiting to prevent notification spam

## Implementation Details

### 1. Enhanced EmailService Methods
```typescript
// New method to detect order-related emails
private isOrderRelatedEmail(email: ProcessedEmail): boolean {
  // Check subject and body for order/distributor keywords
  const orderKeywords = ['order', 'purchase', 'invoice', 'delivery', 'consignment'];
  const distributorKeywords = ['distributor', 'supplier', 'wholesale', 'pharma', 'agency'];
  
  const content = (email.subject + ' ' + email.body).toLowerCase();
  return orderKeywords.some(k => content.includes(k)) && 
         distributorKeywords.some(k => content.includes(k));
}

// New method to extract order information
private async extractOrderInfo(email: ProcessedEmail): Promise<OrderInfo> {
  // Parse email body for structured data
  // Use regex patterns or simple parsing to extract:
  // - Distributor details (from header like "NITIN AGENCY")
  // - Invoice details (Invoice No., Date)
  // - Medicine list with quantities (based on email body format)
  // - Delivery instructions
}

// New method to send attention-grabbing notifications
private async sendDeliveryNotification(orderInfo: OrderInfo): Promise<boolean> {
  const message = this.formatAttentionGainingNotification(orderInfo);
  const whatsAppSuccess = await this.sendWhatsAppNotification(message);
  const telegramSuccess = await this.sendTelegramNotification(message);
  return whatsAppSuccess && telegramSuccess;
}

// New method to format noticeable notifications
private formatAttentionGainingNotification(orderInfo: OrderInfo): string {
  // Use emojis, spacing, clear sections, and visual separators
  // to make notifications stand out in WhatsApp/Telegram
  return `
🚨🚨🚨 NEW ORDER ALERT 🚨🚨🚨

📦 ORDER DETAILS:
• Medicines: ${this.formatMedicineList(orderInfo.medicines)}
• Total Items: ${orderInfo.medicines.reduce((sum, m) => sum + parseInt(m.quantity || '0'), 0)}
• Urgency: ${orderInfo.urgencyLevel === 'high' ? '🔴 HIGH' : '🟢 NORMAL'}

🏭 PICKUP INFORMATION:
• From: ${orderInfo.distributorName} ⭐
• Contact: ${orderInfo.distributorContact}
• Address: ${orderInfo.distributorAddress}
${orderInfo.pickupInstructions ? `• Pickup: ${orderInfo.pickupInstructions}` : ''}

🏥 DELIVERY INFORMATION:
• To: [Pharmacy Name]
• Contact: [Pharmacy Phone]
• Address: [Pharmacy Address]

📅 TIMESTAMPS:
• Order Received: ${new Date().toLocaleString()}
• Action Required: Collect & deliver ASAP

💡 INSTRUCTIONS:
Please collect the above medicines from ${orderInfo.distributorName} and deliver to our pharmacy.
Reply "DONE" upon completion.
  `.trim();
}
```

### 2. Data Structures
```typescript
interface OrderInfo {
  distributorName: string;
  distributorContact: string;
  distributorAddress: string;
  invoiceNumber: string;
  invoiceDate: string;
  medicines: Array<{ name: string; quantity: string; unit?: string; price?: string }>;
  deliveryAddress: string;
  pickupInstructions?: string;
  urgencyLevel: 'normal' | 'high';
  receivedTimestamp: Date;
}

// Extend existing ProcessedEmail or create new interface
```

### 3. Configuration
- Add new environment variables for notification recipients:
  - `DELIVERY_BOY_WHATSAPP_NUMBERS` (comma-separated)
  - `DELIVERY_BOY_TELEGRAM_CHAT_IDS` (comma-separated)
  - `NOTIFICATION_ENABLED` (boolean flag)

## Error Cases & Handling
1. **No order detected**: Log as non-order email, continue processing
2. **Incomplete order info**: Send notification with available data + warning
3. **WhatsApp send failed**: Log error, retry once, notify admin via Telegram
4. **Telegram send failed**: Log error, retry once, notify admin via WhatsApp
5. **Email parsing error**: Log error, move to next email
6. **Database logging failure**: Continue processing, log to console

## Testing Strategy
1. **Unit Tests**:
   - Test email order detection logic
   - Test order information extraction from samples (including Nitin Agency format)
   - Test notification message formatting for visibility
   - Test error handling paths

2. **Integration Tests**:
   - Test end-to-end email processing to notification flow
   - Test WhatsApp and Telegram API integrations
   - Test database logging

3. **Manual Testing**:
   - Send test order emails to monitored inbox (including Nitin Agency format)
   - Verify WhatsApp and Telegram notifications are noticeable and attention-grabbing
   - Check database logs for proper recording
   - Test error conditions (missing info, API failures)

## Future Enhancements
- Add attachment processing forPDF/Excel order sheets
- Implement two-way confirmation (delivery boy confirms completion)
- Add escalation notifications for overdue pickups
- Integrate with existing order management system
- Add delivery time estimation and tracking
- Support multiple language notifications
- Add delivery boy acknowledgment tracking

## Open Questions
1. What specific format do distributor emails typically use for medicine lists? (Based on Nitin Agency sample, we expect to see item lists after the invoice header)
2. Are there specific distributor formats we need to handle differently besides the Nitin Agency format?
3. Should notifications go to individual delivery boys or a group chat?
4. What pharmacy address/contact info should be included in notifications?
5. How should we handle multiple items in the medicine list for display in notifications?

---
*Design reviewed and ready for approval. Updated to emphasize noticeable/popup-style notifications as requested.*