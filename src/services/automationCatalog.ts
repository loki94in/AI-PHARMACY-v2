import { dbManager } from '../database/connection.js';

export interface AutomationCatalogEntry {
  id: string;
  label: string;
  description: string;
  appSettingsKey: string;
  defaultEnabled: boolean;
}

export const AUTOMATION_CATALOG: AutomationCatalogEntry[] = [
  {
    id: 'pos_bill',
    label: 'POS Bill Message',
    description: 'Sends the bill/receipt over WhatsApp when a cashier ticks "send WhatsApp" at checkout.',
    appSettingsKey: 'trigger_wa_pos_bill_enabled',
    defaultEnabled: true,
  },
  {
    id: 'invoice_pdf',
    label: 'Invoice PDF Delivery',
    description: 'Sends the generated invoice PDF to the customer over WhatsApp.',
    appSettingsKey: 'trigger_wa_invoice_pdf_enabled',
    defaultEnabled: true,
  },
  {
    id: 'distributor_collection',
    label: 'Distributor Collection Orders',
    description: 'Notifies the delivery boy and distributors when stock needs to be collected.',
    appSettingsKey: 'trigger_wa_distributor_collection_enabled',
    defaultEnabled: true,
  },
  {
    id: 'pharmarack_batch',
    label: 'Pharmarack Batch Dispatch',
    description: 'Sends the delivery boy summary and one message per distributor for a Pharmarack cart batch.',
    appSettingsKey: 'trigger_wa_pharmarack_batch_enabled',
    defaultEnabled: true,
  },
  {
    id: 'single_distributor_order',
    label: 'Single Distributor Order',
    description: 'Sends a dispatch message for one distributor order.',
    appSettingsKey: 'trigger_wa_single_distributor_order_enabled',
    defaultEnabled: true,
  },
  {
    id: 'credit_reminder',
    label: 'Customer Credit Reminder',
    description: 'Sends a payment-due reminder to a customer with outstanding credit/ledger balance.',
    appSettingsKey: 'trigger_wa_credit_reminder_enabled',
    defaultEnabled: true,
  },
  {
    id: 'payment_receipt',
    label: 'Payment Receipt',
    description: 'Sends a receipt over WhatsApp after a customer payment is recorded.',
    appSettingsKey: 'trigger_wa_payment_receipt_enabled',
    defaultEnabled: true,
  },
  {
    id: 'doctor_daily_summary',
    label: 'Doctor Daily Prescription Summary',
    description: "Sends each referring doctor a daily summary of their patients' prescriptions.",
    appSettingsKey: 'trigger_wa_doctor_daily_summary_enabled',
    defaultEnabled: true,
  },
  {
    id: 'expiry_report',
    label: 'Near-Expiry Inventory Alert',
    description: 'Sends the owner a summary of inventory nearing expiry.',
    appSettingsKey: 'trigger_wa_expiry_report_enabled',
    defaultEnabled: true,
  },
  {
    id: 'bounced_products_alert',
    label: 'Bounced Products Alert',
    description: 'Alerts the owner about distributor products that bounced or were short-delivered.',
    appSettingsKey: 'trigger_wa_bounced_products_alert_enabled',
    defaultEnabled: true,
  },
  {
    id: 'shortage_notice',
    label: 'Shortage / Special-Order Follow-up',
    description: 'Notifies the admin about pending shortage or special-order requests.',
    appSettingsKey: 'trigger_wa_shortage_notice_enabled',
    defaultEnabled: true,
  },
  {
    id: 'refill_reminder',
    label: 'Patient Refill Reminder',
    description: 'Sends refill reminders to patients (single medicine, consolidated, due-tomorrow, and send-now variants).',
    appSettingsKey: 'trigger_wa_refill_reminder_enabled',
    defaultEnabled: true,
  },
  {
    id: 'dispatch_reminder',
    label: 'Distributor Dispatch Reminder',
    description: 'Reminds a distributor when the delivery boy has not dropped off stock.',
    appSettingsKey: 'trigger_wa_dispatch_reminder_enabled',
    defaultEnabled: true,
  },
  {
    id: 'monthly_report',
    label: 'Monthly / Periodic Report',
    description: 'Sends the owner scheduled periodic reports (text, PDF, or Excel).',
    appSettingsKey: 'trigger_wa_monthly_report_enabled',
    defaultEnabled: true,
  },
  {
    id: 'admin_escalation',
    label: 'AI Admin Escalation',
    description: 'Escalates an unresolved WhatsApp medicine query to the admin when the AI cannot confidently answer it.',
    appSettingsKey: 'wa_auto_share_admin',
    defaultEnabled: true,
  },
  {
    id: 'medicine_discovery_suggestion',
    label: 'Unknown Medicine Discovery Suggestion',
    description: 'Suggests composition and schedule info for a medicine mentioned over WhatsApp that is not yet in the catalog.',
    appSettingsKey: 'trigger_wa_medicine_discovery_enabled',
    defaultEnabled: true,
  },
];

/** Reads app_settings for every catalog entry's key in one query, defaulting missing keys to enabled ('true'). */
export async function getAutomationToggleStates(): Promise<Record<string, boolean>> {
  const db = await dbManager.getConnection();
  const keys = AUTOMATION_CATALOG.map(e => e.appSettingsKey);
  const placeholders = keys.map(() => '?').join(',');
  const rows = keys.length
    ? await db.all(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`, keys)
    : [];
  const valueByKey = new Map(rows.map((r: any) => [r.key, r.value]));
  const result: Record<string, boolean> = {};
  for (const entry of AUTOMATION_CATALOG) {
    const raw = valueByKey.get(entry.appSettingsKey);
    result[entry.id] = raw === undefined ? entry.defaultEnabled : raw !== 'false';
  }
  return result;
}
