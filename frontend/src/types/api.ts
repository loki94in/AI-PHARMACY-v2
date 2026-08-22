export interface DashboardStats {
  todaySales: number;
  lowStock: number;
  pendingTasks: number;
  storageLocations?: number;
  pendingSpecialOrders?: number;
  activeDeliveryBoys?: number;
  todayPurchases?: number;
  alerts?: Array<{
    id: number;
    description: string;
    created_at: string;
  }>;
  recentSales?: Array<{
    id: number;
    invoice_no: string;
    customer_name?: string;
    total_amount: number;
    payment_medium?: string;
    payment_status?: string;
    date: string;
  }>;
  recentCommunications?: Array<{
    type?: string;
    title: string;
    recipient_or_sender?: string;
    created_at: string;
  }>;
}

export interface Medicine {
  id: number;
  name: string;
  generic_name?: string;
  api_reference?: string;
  item_code?: string;
  strength?: string;
  packaging?: string;
  pack_unit?: string;
  item_type?: string;
  category?: string;
  manufacturer?: string;
  marketed_by?: string;
  manufactured_by?: string;
  mrp?: number;
  sell_price?: number | string | null;
  purchase_price?: number;
  gst?: string;
  hsn?: string;
  hsn_code?: string;
  cgst_per?: number;
  sgst_per?: number;
  igst_per?: number;
  pack_size?: number;
  schedule_type?: string;
  therapeutic?: string;
  sub_therapeutic?: string;
  short_code?: string;
  ucode?: string;
  max_stock_level?: number;
  rack?: string;
  disable_auto_barcode?: number | boolean;
  tb_medicine?: number | boolean;
  allow_loose_sale?: number | boolean;
  metadata?: unknown;
}

export interface InventoryItem extends Medicine {
  batch_number: string;
  expiry_date: string;
  stock_quantity: number;
  loose_quantity: number;
  rack_location?: string;
  medicine_id?: number;
  medicine_name?: string;
}

export interface SpecialOrder {
  id: number;
  product: string;
  requester: string;
  phone: string;
  qty: number;
  priority: string;
  status: string;
  date: string;
  notified: number;
  notes?: string;
  language?: string;
  pharmarack_distributor?: string;
  pharmarack_rate?: number;
  pharmarack_mrp?: number;
  pharmarack_mapped?: number;
  pharmarack_scheme?: string;
  advance_payment?: number;
  cart_add_error?: string | null;
  sendWhatsApp?: boolean;
}

export interface Refill {
  id: number;
  patient_name: string;
  patient_phone: string;
  medicine_id: number;
  medicine_name?: string;
  refill_interval_days: number;
  last_refill_date: string;
  next_refill_date: string;
  status: string;
  hold_for_stock?: number;
  is_active: number;
  is_ready?: number;
  quantity_needed?: number;
  in_stock_qty?: number;
  reminder_status?: 'NOT_SENT' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  reminder_sent_at?: string | null;
  reminder_job_id?: number | null;
  reminder_occurrence_date?: string | null;
}

export interface AutomationNotification {
  id: number;
  type: string;
  recipient_name: string;
  recipient_phone: string;
  message: string;
  status: string;
  error_message?: string;
  created_at: string;
  reference_id?: string;
}

export interface Patient {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export interface Doctor {
  id: number;
  name: string;
  specialization?: string;
  phone?: string;
  hospital?: string;
  clinic_name?: string;
  commission_percent?: number;
  registration_no?: string;
  reg_no?: string;
}

export interface Distributor {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  gstin?: string;
}
