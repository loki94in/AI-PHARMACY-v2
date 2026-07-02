import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../lib/theme';

interface CartItemProps {
  name: string;
  batch: string;
  qty: number;
  price: number;
  onRemove?: () => void;
  onQtyChange?: (qty: number) => void;
}

export default function CartItem({ name, batch, qty, price, onRemove, onQtyChange }: CartItemProps) {
  const total = qty * price;

  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.meta}>Batch: {batch}  |  ₹{price.toFixed(2)} × {qty}</Text>
      </View>
      <View style={styles.actions}>
        <Text style={styles.total}>₹{total.toFixed(2)}</Text>
        <View style={styles.qtyRow}>
          <TouchableOpacity onPress={() => onQtyChange?.(Math.max(1, qty - 1))} style={styles.qtyBtn}>
            <Ionicons name="remove" size={16} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.qtyText}>{qty}</Text>
          <TouchableOpacity onPress={() => onQtyChange?.(qty + 1)} style={styles.qtyBtn}>
            <Ionicons name="add" size={16} color={colors.textPrimary} />
          </TouchableOpacity>
          {onRemove && (
            <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  info: { flex: 1, marginRight: spacing.sm },
  name: { ...typography.body, fontWeight: '600' },
  meta: { ...typography.caption, marginTop: 4 },
  actions: { alignItems: 'flex-end' },
  total: { ...typography.body, color: colors.accent, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: { ...typography.body, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(239,68,68,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
