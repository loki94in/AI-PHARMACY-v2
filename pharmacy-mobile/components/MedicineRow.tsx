import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../lib/theme';
import { stockLevel } from '../lib/stock';

interface MedicineRowProps {
  name: string;
  batch?: string;
  quantity: number;
  expiry?: string;
  rack?: string;
  onPress?: () => void;
}

export default function MedicineRow({ name, batch, quantity, expiry, rack, onPress }: MedicineRowProps) {
  const level = stockLevel(quantity);
  const isExpiringSoon = expiry ? new Date(expiry) < new Date(Date.now() + 90 * 86400000) : false;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.stockDot, { backgroundColor: level.color }]} />
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.metaRow}>
          {batch ? <Text style={styles.meta}>Batch: {batch}</Text> : null}
          {rack ? <Text style={styles.meta}>Rack: {rack}</Text> : null}
        </View>
      </View>
      <View style={styles.right}>
        <View style={[styles.qtyBadge, { backgroundColor: level.color + '22' }]}>
          <Text style={[styles.qtyText, { color: level.color }]}>{quantity}</Text>
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
  stockDot: { width: 8, height: 8, borderRadius: 8, marginRight: spacing.sm },
  name: { ...typography.body, fontWeight: '600' },
  metaRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  meta: { ...typography.caption },
  right: { alignItems: 'flex-end' },
  qtyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  qtyText: { ...typography.bodySmall, fontWeight: '700' },
  expiry: { ...typography.caption, marginTop: 4 },
  expiryWarn: { color: colors.warning },
});
