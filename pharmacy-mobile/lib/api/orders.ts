import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

// ─── Special Orders (Quick Assist / Shortage) ──────────────────────────────

export interface SpecialOrderPayload {
  product: string;
  requester?: string;
  phone?: string;
  qty?: number;
  priority?: string;
}

const OFFLINE_SPECIAL_ORDERS_KEY = 'offline_special_orders_queue';

export async function getOfflineSpecialOrdersQueue(): Promise<SpecialOrderPayload[]> {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_SPECIAL_ORDERS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get offline special orders queue:', e);
    return [];
  }
}

export async function queueOfflineSpecialOrder(payload: SpecialOrderPayload): Promise<void> {
  try {
    const currentQueue = await getOfflineSpecialOrdersQueue();
    currentQueue.push(payload);
    await AsyncStorage.setItem(OFFLINE_SPECIAL_ORDERS_KEY, JSON.stringify(currentQueue));
  } catch (e) {
    console.error('Failed to queue offline special order:', e);
  }
}

export async function clearOfflineSpecialOrdersQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_SPECIAL_ORDERS_KEY);
  } catch (e) {
    console.error('Failed to clear offline special orders queue:', e);
  }
}

export async function createSpecialOrder(payload: SpecialOrderPayload): Promise<{ success: boolean; id?: number; isOffline?: boolean }> {
  try {
    const res = await request<any>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        product: payload.product,
        requester: payload.requester || 'Mobile App',
        phone: payload.phone || '',
        qty: payload.qty || 1,
        priority: payload.priority || 'NORMAL',
        source: 'Mobile App',
      }),
    });
    return { success: true, id: res.id || res.lastID };
  } catch (err) {
    console.warn('Online special order failed, queueing offline:', err);
    await queueOfflineSpecialOrder(payload);
    return { success: true, isOffline: true };
  }
}

// ─── Special Orders List & Status (Billing Pending Panel) ─────────────────

export interface SpecialOrder {
  id: number;
  product?: string;
  medicine_name?: string;
  requester?: string;
  phone?: string;
  qty?: number;
  priority?: string;
  status?: string;
  notified?: number;
  date?: string;
}

// Active statuses shown in the mobile Pending panel (mirrors desktop CRM)
export const ACTIVE_ORDER_STATUSES = ['Pending', 'Ordered', 'Waiting', 'Ready'];

export async function getOrders(): Promise<SpecialOrder[]> {
  const orders = await request<SpecialOrder[]>('/orders');
  return Array.isArray(orders) ? orders : [];
}

const ORDER_STATUS_QUEUE_KEY = 'offline_order_status_queue';

export interface OrderStatusPayload {
  id: number;
  status: string;
  queued_at: string;
  error?: string;
}

export async function getOfflineOrderStatusQueue(): Promise<OrderStatusPayload[]> {
  try {
    const data = await AsyncStorage.getItem(ORDER_STATUS_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

async function saveOrderStatusQueue(queue: OrderStatusPayload[]): Promise<void> {
  await AsyncStorage.setItem(ORDER_STATUS_QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Update a special order's status (e.g. Mark Ready). When the PC backend marks
 * an order Ready it queues the arrival WhatsApp inside this same request
 * (response.whatsapp_queued). Offline: the status change is queued and replayed
 * on reconnect — no message is ever sent without this explicit user action.
 */
export async function updateOrderStatus(
  id: number,
  status: string
): Promise<{ success: boolean; whatsapp_queued?: boolean; isOffline?: boolean }> {
  try {
    const res = await request<{ success: boolean; whatsapp_queued?: boolean }>(`/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    // If this status was previously queued offline, drop it now
    const queue = await getOfflineOrderStatusQueue();
    await saveOrderStatusQueue(queue.filter(q => q.id !== id));
    return { success: !!res.success, whatsapp_queued: !!res.whatsapp_queued };
  } catch (err) {
    console.warn(`Online order status update failed, queueing offline:`, err);
    const queue = await getOfflineOrderStatusQueue();
    queue.push({ id, status, queued_at: new Date().toISOString() });
    await saveOrderStatusQueue(queue);
    return { success: true, isOffline: true };
  }
}
