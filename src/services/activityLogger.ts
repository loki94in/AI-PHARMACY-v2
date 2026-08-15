import { dbManager } from '../database/connection.js';
import EventEmitter from 'events';

export type ActivityActionType =
  | 'ADD'
  | 'SAVE'
  | 'EDIT'
  | 'DELETE'
  | 'SALE'
  | 'PURCHASE'
  | 'AUTOMATION'
  | 'BACKUP'
  | 'PROCESS_STARTED'
  | 'PROCESS_DONE'
  | 'PROCESS_FAIL'
  | 'STOCK_OVERRIDE'
  | 'SYSTEM_ALERT';

export interface ActivityLogItem {
  id?: number;
  action_type: ActivityActionType | string;
  description: string;
  metadata?: any;
  created_at?: string;
}

class ActivityLogger extends EventEmitter {
  /**
   * Log any activity into action_logs database table and emit real-time event.
   */
  async logActivity(
    actionType: ActivityActionType | string,
    description: string,
    metadata?: Record<string, any>
  ): Promise<number | null> {
    try {
      const db = await dbManager.getConnection();
      const metaStr = metadata ? JSON.stringify(metadata) : null;
      const result = await db.run(
        'INSERT INTO action_logs (action_type, description, metadata) VALUES (?, ?, ?)',
        [actionType, description, metaStr]
      );
      const insertedId = result.lastID ?? null;

      const logItem: ActivityLogItem = {
        id: insertedId ?? undefined,
        action_type: actionType,
        description,
        metadata: metadata || null,
        created_at: new Date().toISOString()
      };

      this.emit('activity_logged', logItem);
      return insertedId;
    } catch (err) {
      console.error('[ActivityLogger] Error logging activity:', err);
      return null;
    }
  }

  // Convenience helper methods
  async logAdd(entityName: string, details: string, metadata?: Record<string, any>) {
    return this.logActivity('ADD', `Added ${entityName}: ${details}`, metadata);
  }

  async logSave(entityName: string, details: string, metadata?: Record<string, any>) {
    return this.logActivity('SAVE', `Saved ${entityName}: ${details}`, metadata);
  }

  async logEdit(entityName: string, details: string, metadata?: Record<string, any>) {
    return this.logActivity('EDIT', `Edited ${entityName}: ${details}`, metadata);
  }

  async logDelete(entityName: string, details: string, metadata?: Record<string, any>) {
    return this.logActivity('DELETE', `Deleted ${entityName}: ${details}`, metadata);
  }

  async logSale(invoiceNo: string, amount: number, customerName?: string, status: string = 'saved') {
    const custStr = customerName ? ` for customer ${customerName}` : '';
    return this.logActivity(
      'SALE',
      `Selling Bill #${invoiceNo} (${status})${custStr} — Amount: ₹${amount.toLocaleString('en-IN')}`,
      { invoiceNo, amount, customerName, status }
    );
  }

  async logPurchase(invoiceNo: string, amount: number, distributorName?: string, status: string = 'saved') {
    const distStr = distributorName ? ` from ${distributorName}` : '';
    return this.logActivity(
      'PURCHASE',
      `Purchase Invoice #${invoiceNo} (${status})${distStr} — Total: ₹${amount.toLocaleString('en-IN')}`,
      { invoiceNo, amount, distributorName, status }
    );
  }

  async logAutomation(channel: string, recipient: string, status: string, messagePreview?: string) {
    const isSuccess = status === 'sent' || status === 'delivered';
    const actionType = isSuccess ? 'AUTOMATION' : 'PROCESS_FAIL';
    const previewStr = messagePreview ? ` ("${messagePreview.slice(0, 40)}...")` : '';
    return this.logActivity(
      actionType,
      `Automation [${channel}] to ${recipient} — Status: ${status.toUpperCase()}${previewStr}`,
      { channel, recipient, status, messagePreview }
    );
  }

  async logBackup(backupType: string, status: string, details?: string) {
    const actionType = status === 'failed' ? 'PROCESS_FAIL' : 'BACKUP';
    return this.logActivity(
      actionType,
      `Backup [${backupType}] — ${status.toUpperCase()}${details ? `: ${details}` : ''}`,
      { backupType, status, details }
    );
  }

  async logProcess(processName: string, status: 'started' | 'done' | 'fail', details?: string) {
    let actionType: ActivityActionType = 'PROCESS_DONE';
    if (status === 'started') actionType = 'PROCESS_STARTED';
    if (status === 'fail') actionType = 'PROCESS_FAIL';

    return this.logActivity(
      actionType,
      `Process [${processName}] ${status.toUpperCase()}${details ? `: ${details}` : ''}`,
      { processName, status, details }
    );
  }
}

export const activityLogger = new ActivityLogger();
