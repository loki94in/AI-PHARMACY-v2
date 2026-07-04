export interface DashboardStats {
  todaySales: number;
  lowStock: number;
  pendingTasks: number;
  alerts?: Array<{
    id: number;
    description: string;
    created_at: string;
  }>;
}

export interface Medicine {
  id: number;
  name: string;
  api_reference?: string;
  item_code?: string;
  strength?: string;
  packaging?: string;
  item_type?: string;
  manufacturer?: string;
  marketed_by?: string;
  manufactured_by?: string;
  mrp?: number;
  purchase_price?: number;
  gst?: string;
  hsn?: string;
  pack_size?: string;
  schedule_type?: string;
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
  pharmarack_distributor?: string;
  pharmarack_rate?: number;
  pharmarack_mrp?: number;
  pharmarack_mapped?: number;
  pharmarack_scheme?: string;
  advance_payment?: number;
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
  commission_percent?: number;
  registration_no?: string;
}

export interface Distributor {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  gstin?: string;
}
