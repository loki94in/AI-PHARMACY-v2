import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../lib/theme';
import { SearchMedicineResult, SpecialOrder, ACTIVE_ORDER_STATUSES, parsePackSize } from '../lib/api';
import { stockLevel } from '../lib/stock';

interface ProductGroup {
  key: string;
  name: string;
  totalStock: number;
  packSize: number;
  mrp: number;
  batchCount: number;
  representative: SearchMedicineResult;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  Pending: { color: colors.info, label: 'PENDING' },
  Ordered: { color: colors.primary, label: 'ORDERED' },
  Waiting: { color: colors.warning, label: 'WAITING' },
  Ready: { color: colors.success, label: 'READY' },
  Fulfilled: { color: colors.textMuted, label: 'FULFILLED' },
  Cancelled: { color: colors.danger, label: 'CANCELLED' },
};

interface Props {
  visible: boolean;
  onClose: () => void;
  products: SearchMedicineResult[];
  onAddProduct: (item: SearchMedicineResult) => void;
  pendingOrders: SpecialOrder[];
  offlinePendingCount?: number;
  onMarkReady: (order: SpecialOrder) => void;
  refreshingPending?: boolean;
  onRefreshPending: () => void;
}

export default function ProductListPanel({
  visible,
  onClose,
  products,
  onAddProduct,
  pendingOrders,
  offlinePendingCount = 0,
  onMarkReady,
  refreshingPending,
  onRefreshPending,
}: Props) {
  const [segment, setSegment] = useState<'products' | 'pending'>('products');
  const [query, setQuery] = useState('');

  // Group batch rows into one shopping-list row per medicine
  const groups: ProductGroup[] = useMemo(() => {
    const map = new Map<string, ProductGroup>();
    for (const row of products) {
      const nameKey = (row.medicine_name || '').toLowerCase().trim();
      if (!nameKey) continue;
      const existing = map.get(nameKey);
      if (existing) {
        existing.totalStock += Number(row.quantity) || 0;
        existing.batchCount += 1;
        if ((row.mrp || 0) > (existing.mrp || 0)) existing.mrp = row.mrp || 0;
      } else {
        map.set(nameKey, {
          key: nameKey,
          name: row.medicine_name,
          totalStock: Number(row.quantity) || 0,
          packSize: parsePackSize((row as any).pack_size),
          mrp: row.mrp || row.unit_price || 0,
          batchCount: 1,
          representative: row,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      g => g.name.toLowerCase().includes(q) || (g.representative.item_code || '').toLowerCase().includes(q)
    );
  }, [groups, query]);

  const activeOrders = useMemo(
    () => pendingOrders.filter(o => ACTIVE_ORDER_STATUSES.includes(o.status || '')),
    [pendingOrders]
  );

  const pendingFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeOrders;
    return activeOrders.filter(o =>
      `${o.product || o.medicine_name || ''}`.toLowerCase().includes(q)
    );
  }, [activeOrders, query]);

  const renderProductRow = ({ item }: { item: ProductGroup }) => {
    const level = stockLevel(item.totalStock);
    return (
      <TouchableOpacity
        style={styles.productRow}
        onPress={() => onAddProduct(item.representative)}
        activeOpacity={0.7}
      >
        <View style={[styles.stockDot, { backgroundColor: level.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.productName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.productMeta} numberOfLines={1}>
            {item.mrp > 0 ? `₹${Number(item.mrp).toFixed(0)} · ` : ''}
            Pack {item.packSize} · {item.batchCount} batch{item.batchCount !== 1 ? 'es' : ''}
          </Text>
        </View>
        <View style={[styles.stockBadge, { backgroundColor: level.color + '22', borderColor: level.color + '55' }]}>
          <Text style={[styles.stockBadgeText, { color: level.color }]}>
            {item.totalStock}
          </Text>
        </View>
        <Ionicons name="add-circle" size={20} color={colors.primary} />
      </TouchableOpacity>
    );
  };

  const renderPendingRow = ({ item }: { item: SpecialOrder }) => {
    const meta = STATUS_META[item.status || ''] || STATUS_META.Pending;
    const canMarkReady = item.status && ['Pending', 'Ordered', 'Waiting'].includes(item.status);
    return (
      <View style={styles.pendingRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.pendingName} numberOfLines={1}>
              {item.product || item.medicine_name || 'Unknown'}
            </Text>
            <View style={[styles.statusChip, { backgroundColor: meta.color + '22', borderColor: meta.color + '55' }]}>
              <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {(item.notified || 0) === 1 && (
              <Ionicons name="checkmark-done-circle" size={13} color={colors.success} />
            )}
          </View>
          <Text style={styles.pendingMeta} numberOfLines={1}>
            x{item.qty || 1} · {item.requester || '—'} · {item.priority || 'NORMAL'}
          </Text>
        </View>
        {canMarkReady && (
          <TouchableOpacity
            style={styles.markReadyBtn}
            onPress={() => onMarkReady(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark" size={12} color="#fff" />
            <Text style={styles.markReadyText}>Ready</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="list" size={18} color={colors.primary} />
            <Text style={styles.headerTitle}>Product List</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Segment toggle */}
          <View style={styles.segmentRow}>
            <TouchableOpacity
              style={[styles.segmentBtn, segment === 'products' && styles.segmentBtnActive]}
              onPress={() => setSegment('products')}
            >
              <Text style={[styles.segmentText, segment === 'products' && styles.segmentTextActive]}>
                Products ({groups.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentBtn, segment === 'pending' && styles.segmentBtnActive]}
              onPress={() => setSegment('pending')}
            >
              <Text style={[styles.segmentText, segment === 'pending' && styles.segmentTextActive]}>
                Pending ({activeOrders.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <Ionicons name="search" size={14} color={colors.primary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={segment === 'products' ? 'Filter products...' : 'Filter requests...'}
              placeholderTextColor={colors.textMuted}
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {segment === 'pending' && (
            <TouchableOpacity style={styles.refreshRow} onPress={onRefreshPending} disabled={refreshingPending}>
              {refreshingPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="refresh" size={12} color={colors.primary} />
              )}
              <Text style={styles.refreshText}>Refresh from PC</Text>
            </TouchableOpacity>
          )}

          {/* Lists */}
          {segment === 'products' ? (
            filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="medkit-outline" size={30} color={colors.textMuted} />
                <Text style={styles.emptyText}>No products cached yet — connect to PC once to sync</Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={g => g.key}
                renderItem={renderProductRow}
                keyboardShouldPersistTaps="handled"
              />
            )
          ) : pendingFiltered.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="flash-outline" size={30} color={colors.textMuted} />
              <Text style={styles.emptyText}>No active special requests</Text>
            </View>
          ) : (
            <FlatList
              data={pendingFiltered}
              keyExtractor={o => `order-${o.id}`}
              renderItem={renderPendingRow}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {/* Footer legend */}
          <View style={styles.footer}>
            {segment === 'products' ? (
              <>
                <LegendDot color={colors.danger} label="Out" />
                <LegendDot color={colors.warning} label="<10" />
                <LegendDot color="#EAB308" label="<30" />
                <LegendDot color={colors.success} label="In stock" />
              </>
            ) : (
              <>
                {offlinePendingCount > 0 && (
                  <Text style={styles.offlineQueueNote}>
                    {offlinePendingCount} status change{offlinePendingCount !== 1 ? 's' : ''} queued for sync
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <View style={[styles.stockDot, { backgroundColor: color, width: 7, height: 7 }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  panel: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRightWidth: 2,
    borderRightColor: colors.cardBorder,
    paddingTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, flex: 1 },
  closeBtn: { padding: 4 },

  segmentRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  segmentTextActive: { color: '#fff' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: 6,
  },
  searchInput: { flex: 1, height: 34, fontSize: 13, color: colors.textPrimary },

  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  refreshText: { fontSize: 11, fontWeight: '700', color: colors.primary },

  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    marginHorizontal: spacing.md,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  stockDot: { width: 9, height: 9, borderRadius: 9 },
  productName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  productMeta: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  stockBadge: {
    minWidth: 34,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  stockBadgeText: { fontSize: 11, fontWeight: '800' },

  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    marginHorizontal: spacing.md,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pendingName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  pendingMeta: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  statusChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  markReadyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.success,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  markReadyText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },

  footer: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  legendText: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  offlineQueueNote: { fontSize: 10, color: colors.warning, fontWeight: '700' },
});
