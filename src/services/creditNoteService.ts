import { Database } from 'sqlite';
import { telegramBotService } from '../telegramBot.js';

export async function trackExpiryReturn(
  db: Database,
  returnId: number,
  distributorId: number,
  originalAmount: number,
  lossPercentage: number = 3.0
): Promise<void> {
  const expectedCreditAmount = originalAmount * (1 - lossPercentage / 100);
  
  // Calculate 3 months in the future for reminder
  const reminderDate = new Date();
  reminderDate.setMonth(reminderDate.getMonth() + 3);
  const reminderStr = reminderDate.toISOString().slice(0, 19).replace('T', ' ');

  await db.run(
    `INSERT INTO expiry_returns_tracking (return_id, distributor_id, original_amount, loss_percentage, expected_credit_amount, reminder_date, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [returnId, distributorId, originalAmount, lossPercentage, expectedCreditAmount, reminderStr]
  );
}

export async function checkOverdueCreditNotes(db: Database): Promise<void> {
  const overdueItems = await db.all(
    `SELECT ert.*, d.name as distributor_name FROM expiry_returns_tracking ert
     JOIN distributors d ON ert.distributor_id = d.id
     WHERE ert.status IN ('pending', 'overdue') AND ert.reminder_date <= CURRENT_TIMESTAMP`
  );

  for (const item of overdueItems) {
    const alertMessage = `⚠️ OVERDUE EXPIRY CREDIT NOTE:
You returned expired medicines worth ₹${Number(item.original_amount).toFixed(2)} to "${item.distributor_name}" 3 months ago (on ${item.return_date}).
Expected Credit Note Value: ₹${Number(item.expected_credit_amount).toFixed(2)} (after ~${item.loss_percentage}% standard loss).
Please follow up with the distributor to claim your credit!`;

    try {
      await telegramBotService.sendDefaultNotification(alertMessage);
      // Mark as overdue in the database
      await db.run("UPDATE expiry_returns_tracking SET status = 'overdue' WHERE id = ?", [item.id]);
    } catch (err) {
      console.error('Failed to send overdue credit note alert to Telegram:', err);
    }
  }
}

export async function reconcileCreditNote(
  db: Database,
  distributorId: number,
  actualCreditAmount: number,
  purchaseId?: number
): Promise<{ success: boolean; message: string; remainingAmount?: number }> {
  // Find the oldest pending/overdue return for this distributor
  const oldestPending = await db.get(
    `SELECT * FROM expiry_returns_tracking 
     WHERE distributor_id = ? AND status IN ('pending', 'overdue') 
     ORDER BY return_date ASC LIMIT 1`,
    [distributorId]
  );

  if (!oldestPending) {
    return { success: false, message: 'No pending expired returns found for this distributor.' };
  }

  const lossAmount = oldestPending.original_amount - actualCreditAmount;
  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Update tracking record
  await db.run(
    `UPDATE expiry_returns_tracking 
     SET status = 'reconciled', actual_credit_amount = ?, reconciled_date = ?, reconciled_purchase_id = ?
     WHERE id = ?`,
    [actualCreditAmount, nowStr, purchaseId || null, oldestPending.id]
  );

  let message = `Credit note of ₹${actualCreditAmount} successfully reconciled against expired return on ${oldestPending.return_date}.`;

  // Subtract amount from target purchase bill if provided
  if (purchaseId) {
    const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
    if (purchase) {
      const returnRec = oldestPending.return_id 
        ? await db.get('SELECT return_no FROM returns WHERE id = ?', [oldestPending.return_id])
        : null;
      const cnNum = returnRec?.return_no || `CN-${oldestPending.id}`;
      const originalAmount = purchase.original_amount !== null && purchase.original_amount !== undefined
        ? purchase.original_amount
        : purchase.total_amount;
      const newTotal = Math.max(0, originalAmount - actualCreditAmount);
      
      await db.run(
        `UPDATE purchases 
         SET total_amount = ?, cn_amount = ?, cn_number = ?, original_amount = ? 
         WHERE id = ?`,
        [newTotal, actualCreditAmount, cnNum, originalAmount, purchaseId]
      );
      message += ` Purchase bill ID ${purchaseId} updated. New Total: ₹${newTotal}.`;
    }
  }

  // Log the action
  await db.run(
    `INSERT INTO action_logs (action_type, description) 
     VALUES ('RECONCILE_CREDIT_NOTE', ?)`,
    [`Reconciled ₹${actualCreditAmount} for distributor ID ${distributorId}. Oldest return original amount: ₹${oldestPending.original_amount}. Loss amount: ₹${lossAmount.toFixed(2)}.`]
  );

  return { success: true, message };
}
