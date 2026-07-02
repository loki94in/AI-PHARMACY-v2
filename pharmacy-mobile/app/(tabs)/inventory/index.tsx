import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Modal, TouchableOpacity, TextInput, Alert } from 'react-native';
import { colors, spacing, typography, radius } from '../../../lib/theme';
import { getInventory, getInventoryPeek, InventoryItem, isAdminMode, updateStockOverride } from '../../../lib/api';
import SearchBar from '../../../components/SearchBar';
import MedicineRow from '../../../components/MedicineRow';
import Card from '../../../components/Card';
import { Ionicons } from '@expo/vector-icons';

export default function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [peekData, setPeekData] = useState<any[] | null>(null);
  const [peekName, setPeekName] = useState('');
  
  // Admin stock edit state
  const [isAdmin, setIsAdmin] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editReason, setEditReason] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchData = useCallback(async (query = '') => {
    try {
      const data = await getInventory(query);
      setItems(data);
    } catch (e) {
      console.warn('Inventory fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    isAdminMode().then(setIsAdmin);
  }, []);

  // Debounced search fetch
  useEffect(() => {
    if (search.trim()) {
      setLoading(true);
    }
    const timer = setTimeout(() => {
      fetchData(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search, fetchData]);

  const filtered = items;

  const handlePeek = async (item: InventoryItem) => {
    setPeekName(item.medicine_name);
    try {
      const data = await getInventoryPeek(item.medicine_id);
      setPeekData(data);
    } catch {
      setPeekData([]);
    }
  };

  const handleSaveStockOverride = async () => {
    if (!editItem) return;
    const qty = parseInt(editQty, 10);
    if (isNaN(qty) || qty < 0) {
      Alert.alert('Invalid Input', 'Quantity must be a positive number');
      return;
    }
    const reason = editReason.trim();
    if (!reason) {
      Alert.alert('Required Field', 'Reason is required');
      return;
    }

    setUpdating(true);
    try {
      const ok = await updateStockOverride(editItem.id, qty, reason);
      if (ok) {
        if (peekData) {
          setPeekData(prev => 
            prev ? prev.map(b => b.id === editItem.id ? { ...b, quantity: qty } : b) : null
          );
        }
        fetchData();
        setEditItem(null);
        Alert.alert('Success', 'Stock level updated successfully.');
      } else {
        Alert.alert('Error', 'Failed to update stock override.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Error saving stock update');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search medicine, batch, rack..."
        style={{ marginHorizontal: spacing.md, marginTop: spacing.md }}
      />

      <Text style={styles.countText}>{filtered.length} items</Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        renderItem={({ item }) => (
          <MedicineRow
            name={item.medicine_name || 'Unknown'}
            batch={item.batch_no}
            quantity={item.quantity}
            expiry={item.expiry_date}
            rack={item.rack_location}
            onPress={() => handlePeek(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="cube-outline" size={48} color={colors.textMuted} />
            <Text style={[typography.bodySmall, { marginTop: spacing.md }]}>No items found</Text>
          </View>
        }
      />

      {/* Peek Modal */}
      <Modal visible={peekData !== null} transparent animationType="slide" onRequestClose={() => setPeekData(null)}>
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={typography.h3}>{peekName}</Text>
              <TouchableOpacity onPress={() => setPeekData(null)}>
                <Ionicons name="close-circle" size={28} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[typography.label, { marginBottom: spacing.md }]}>BATCH DETAILS</Text>
            {peekData && peekData.length > 0 ? peekData.map((b: any, i: number) => (
              <View key={i} style={styles.peekRow}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={typography.body}>Batch: {b.batch_no || '-'}</Text>
                  {isAdmin && b.id !== undefined && (
                    <TouchableOpacity
                      style={styles.updateStockBtn}
                      onPress={() => {
                        setEditItem(b);
                        setEditQty(String(b.quantity));
                        setEditReason('Stock Correction');
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="create-outline" size={14} color={colors.primary} />
                      <Text style={styles.updateStockText}>Adjust</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={typography.bodySmall}>Qty: {b.quantity} | Exp: {b.expiry_date || '-'}</Text>
                {b.unit_price ? <Text style={typography.bodySmall}>MRP: ₹{b.unit_price} | Cost: ₹{b.cost_price || '-'}</Text> : null}
              </View>
            )) : (
              <Text style={typography.bodySmall}>No batch data available</Text>
            )}
          </Card>
        </View>
      </Modal>

      {/* Edit Stock Modal */}
      <Modal visible={editItem !== null} transparent animationType="fade" onRequestClose={() => setEditItem(null)}>
        <View style={styles.editOverlay}>
          <Card style={styles.editCard}>
            <Text style={typography.h3}>Update Stock Quantity</Text>
            <Text style={[typography.bodySmall, { marginVertical: spacing.sm }]}>
              Batch: {editItem?.batch_no || '-'}
            </Text>
            
            <Text style={styles.fieldLabel}>New Quantity</Text>
            <TextInput
              style={styles.dialogInput}
              value={editQty}
              onChangeText={setEditQty}
              placeholder="e.g. 50"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>Reason for Override</Text>
            <TextInput
              style={styles.dialogInput}
              value={editReason}
              onChangeText={setEditReason}
              placeholder="e.g. Stock audit correction"
              placeholderTextColor={colors.textMuted}
            />

            <View style={styles.dialogButtons}>
              <TouchableOpacity
                onPress={() => setEditItem(null)}
                style={[styles.dialogBtn, styles.dialogBtnCancel]}
                disabled={updating}
              >
                <Text style={styles.dialogBtnTextCancel}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                onPress={handleSaveStockOverride}
                style={[styles.dialogBtn, styles.dialogBtnSave]}
                disabled={updating || !editQty.trim() || !editReason.trim()}
              >
                {updating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogBtnTextSave}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  countText: { ...typography.caption, marginHorizontal: spacing.md, marginTop: spacing.sm },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalCard: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: spacing.lg, maxHeight: '60%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  peekRow: { backgroundColor: colors.surfaceLight, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  editOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  editCard: {
    width: '90%',
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  fieldLabel: {
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  dialogInput: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.sm,
  },
  dialogButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  dialogBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  dialogBtnCancel: {
    backgroundColor: 'transparent',
  },
  dialogBtnSave: {
    backgroundColor: colors.primary,
  },
  dialogBtnTextCancel: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  dialogBtnTextSave: {
    color: '#fff',
    fontWeight: '600',
  },
  updateStockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 4,
  },
  updateStockText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
});
