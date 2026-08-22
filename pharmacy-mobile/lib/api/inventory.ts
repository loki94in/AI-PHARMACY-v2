import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

const INVENTORY_CACHE_KEY = 'cached_inventory_master';

// ─── Inventory ──────────────────────────────────────────────────────────────

export interface SearchMedicineResult {
  inventory_id: number;
  medicine_id: number;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  mrp: number;
  unit_price: number;
  cost_price: number;
  item_code?: string;
  is_out_of_stock?: boolean;
  alternatives?: SearchMedicineResult[];
  cgst_per?: number;
  sgst_per?: number;
  pack_size?: number;
  loose_quantity?: number;
}

export interface InventoryItem {
  id: number;
  medicine_id: number;
  medicine_name: string;
  quantity: number;
  rack_location?: string;
  batch_no?: string;
  expiry_date?: string;
  item_code?: string;
  mrp?: number;
  unit_price?: number;
  loose_quantity?: number;
  cgst_per?: number;
  sgst_per?: number;
  pack_size?: number;
}

// ponytail: parse "STRIP OF 10" / "10x10" / "10 TABS" down to the unit count
export function parsePackSize(raw: any): number {
  if (raw == null) return 1;
  if (typeof raw === 'number' && raw > 0) return raw;
  const s = String(raw);
  const stripOf = s.match(/strip\s*of\s*(\d+)/i);
  if (stripOf) return parseInt(stripOf[1], 10) || 1;
  const mult = s.match(/(\d+)\s*[xX]\s*(\d+)/);
  if (mult) return parseInt(mult[1], 10) * parseInt(mult[2], 10) || 1;
  const tabs = s.match(/(\d+)\s*(?:tabs?|tablets?|caps?|capsules?|s|'s)/i);
  if (tabs) return parseInt(tabs[1], 10) || 1;
  return 1;
}

export async function cacheInventory(items: SearchMedicineResult[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to cache inventory locally:', e);
  }
}

export async function getCachedInventory(): Promise<SearchMedicineResult[]> {
  try {
    const data = await AsyncStorage.getItem(INVENTORY_CACHE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get cached inventory:', e);
    return [];
  }
}

export async function getInventory(search?: string): Promise<InventoryItem[]> {
  try {
    const endpoint = search
      ? `/inventory?search=${encodeURIComponent(search.trim())}`
      : '/inventory?limit=0';
    const raw = await request<any>(endpoint);
    // Backend returns { data: [...] } (paginated) or a plain array
    const items: InventoryItem[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
    // Save to cache mapped to SearchMedicineResult format
    const mapped: SearchMedicineResult[] = items.map(item => ({
      inventory_id: item.id,
      medicine_id: item.medicine_id,
      medicine_name: item.medicine_name,
      batch_no: item.batch_no || '',
      expiry_date: item.expiry_date || '',
      quantity: item.quantity,
      mrp: item.mrp || 0,
      unit_price: item.unit_price || 0,
      cost_price: 0,
      item_code: item.item_code || '',
      cgst_per: item.cgst_per,
      sgst_per: item.sgst_per,
      pack_size: parsePackSize(item.pack_size),
      loose_quantity: item.loose_quantity,
    }));
    // Only cache full list to avoid overwriting cache with partial search results
    if (!search && mapped.length > 0) {
      await cacheInventory(mapped);
    }
    return items;
  } catch (err) {
    console.log('Online getInventory failed, fallback to local cache:', err);
    const cached = await getCachedInventory();
    let result = cached.map(c => ({
      id: c.inventory_id,
      medicine_id: c.medicine_id,
      medicine_name: c.medicine_name,
      quantity: c.quantity,
      batch_no: c.batch_no,
      expiry_date: c.expiry_date,
      item_code: c.item_code
    }));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(item =>
        item.medicine_name?.toLowerCase().includes(q) ||
        item.batch_no?.toLowerCase().includes(q) ||
        item.item_code?.toLowerCase().includes(q)
      );
    }
    return result;
  }
}

export function getInventoryPeek(medicineId: number) {
  return request('/inventory/peek/' + medicineId);
}
