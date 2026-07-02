import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../lib/theme';

interface MedicineRowProps {
  name: string;
  batch?: string;
  quantity: number;
  expiry?: string;
  rack?: string;
  onPress?: () => void;
}

export default function MedicineRow({ name, batch, quantity, expiry, rack, onPress }: MedicineRowProps) {
  const isLowStock = quantity < 5;
  const isExpiringSoon = expiry ? new Date(expiry) < new Date(Date.now() + 90 * 86400000) : false;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.metaRow}>
          {batch ? <Text style={styles.meta}>Batch: {batch}</Text> : null}
          {rack ? <Text style={styles.meta}>Rack: {rack}</Text> : null}
        </View>
      </View>
      <View style={styles.right}>
        <View style={[styles.qtyBadge, isLowStock && styles.qtyLow]}>
          <Text style={[styles.qtyText, isLowStock && styles.qtyTextLow]}>{quantity}</Text>
        </View>
        {expiry ? (
          <Text style={[styles.expiry, isExpiringSoon && styles.expiryWarn]}>
            {expiry}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  left: { flex: 1, marginRight: spacing.md },
  name: { ...typography.body, fontWeight: '600' },
  metaRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  meta: { ...typography.caption },
  right: { alignItems: 'flex-end' },
  qtyBadge: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  qtyLow: { backgroundColor: 'rgba(239,68,68,0.15)' },
  qtyText: { ...typography.bodySmall, color: colors.success, fontWeight: '700' },
  qtyTextLow: { color: colors.danger },
  expiry: { ...typography.caption, marginTop: 4 },
  expiryWarn: { color: colors.warning },
});
