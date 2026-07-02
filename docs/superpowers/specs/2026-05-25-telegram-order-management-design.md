# Telegram Order Management Design for AI Pharmacy

## Overview
This document outlines the design for adding order management capabilities to the existing Telegram bot in the AI Pharmacy application. The feature allows pharmacy owners/managers to view and update order statuses via Telegram commands using an interactive step-by-step flow.

## Requirements
- Allow owner/manager to view recent orders
- Enable updating order status (pending, processing, shipped, delivered, cancelled)
- Show order list first before selecting an order to update
- Use interactive command flow for step-by-step interaction
- Integrate with existing order/sales_invoices database table
- Maintain security by restricting to authorized users (to be implemented via chat ID verification)
- Make command responses clear and easy to understand

## Architecture

### Components
1. **TelegramBotService** (existing): Enhanced with new order management command handlers
2. **Order Management Handler**: New logic for processing order-related Telegram commands
3. **Database Access Layer**: Existing SQLite database operations for orders/sales_invoices
4. **Authorization Layer**: Chat ID verification for owner/manager access

### Data Flow
1. User sends `/orders` command to Telegram bot
2. Bot verifies user is authorized owner/manager
3. Bot fetches recent orders from database (sales_invoices table)
4. Bot formats and sends list of recent orders to user
5. User selects an order by replying with order number
6. Bot shows detailed view of selected order
7. Bot prompts user to select new status from available options
8. User selects new status
9. Bot updates order status in database
10. Bot confirms successful update to user

## Detailed Design

### Command Structure
- `/orders` - Show list of recent orders (last 10 by default)
- Order selection: User replies with order ID from the list
- Status update: After order selection, bot presents status options: pending, processing, shipped, delivered, cancelled

### Database Schema (Existing)
The `sales_invoices` table contains:
- `id` (INTEGER PRIMARY KEY)
- `customer_name` (TEXT)
- `customer_phone` (TEXT)
- `date` (TIMESTAMP)
- `total_amount` (REAL)
- `status` (TEXT - current values: pending, processing, shipped, delivered, cancelled)
- `items` (TEXT - JSON string of order items)
- Other relevant fields

### Implementation Details

#### 1. Enhanced TelegramBotService
Add new method groups:
- `handleOrdersCommand(chatId)` - Fetches and displays recent orders
- `handleOrderSelection(chatId, orderId)` - Shows order details and prompts for status
- `handleStatusSelection(chatId, orderId, newStatus)` - Updates order status
- Helper methods for formatting order lists and details

#### 2. Security Considerations
- Store authorized owner/manager chat IDs in environment variables or database
- Verify sender chat ID against authorized list before processing commands
- Log unauthorized access attempts

#### 3. Error Handling
- Database connection errors
- Order not found errors
- Invalid status transitions
- Telegram API errors
- User input validation errors

#### 4. User Experience Flow
```
User: /orders
Bot: 📋 RECENT ORDERS 📋
     1. #1001 - John Doe - $1,250 - Pending
     2. #1002 - Jane Smith - $875 - Processing
     3. #1003 - Bob Johnson - $2,100 - Shipped
     (Reply with order number to view details)

User: 1002
Bot: 📄 ORDER DETAILS: #1002 📄
     Customer: Jane Smith
     Phone: 555-1234
     Date: 2026-05-20
     Total: $875.00
     Status: Processing
     Items: 
     - Paracetamol 500mg x 20
     - Amoxicillin 250mg x 10
     - Cetirizine 10mg x 15
     Select new status:
     [pending] [processing] [shipped] [delivered] [cancelled]

User: shipped
Bot: ✅ SUCCESS: Order #1002 status updated to 'shipped'
```

## Integration Points
- Extend existing `src/telegramBot.ts` with new command handlers
- Reuse existing database connection patterns from `src/routes/orders.ts`
- Utilize existing `TelegramBotService` notification methods for responses
- Follow same environmental configuration pattern (DB_PATH, TELEGRAM_BOT_TOKEN)

## Error Cases & Handling
1. **Unauthorized user**: "🔒 Access denied. You are not authorized to use this bot."
2. **No orders found**: "📭 No recent orders found."
3. **Invalid order ID**: "❌ Invalid order ID. Please select from the list above."
4. **Database error**: "💥 Failed to retrieve orders. Please try again later."
5. **Invalid status**: "❌ Invalid status selected. Please choose from available options."
6. **Update failed**: "💥 Failed to update order status. Please try again."

## Testing Strategy
1. **Unit Tests**:
   - Test order listing formatting
   - Test order detail formatting
   - Test status validation
   - Test database update logic

2. **Integration Tests**:
   - Test end-to-end command flow
   - Test database interactions
   - Test error handling paths

3. **Manual Testing**:
   - Verify command flow in Telegram
   - Test with various order states
   - Test error conditions

## Future Enhancements
- Add date filtering (/orders today, /orders week)
- Add customer name/search filtering
- Add ability to view order items in detail
- Add photo attachment support for order verification
- Add order cancellation confirmation step
- Add statistics summary with order list

## Open Questions
1. What time range should "recent orders" default to? (Last 24 hours? Last 7 days?)
2. How many orders should be shown in the initial list?
3. Should we show order items in the initial list or only in detailed view?
4. Are there specific status transition rules we should enforce? (e.g., can't go from delivered back to pending)

---
*Design reviewed and ready for approval. All placeholders addressed.*