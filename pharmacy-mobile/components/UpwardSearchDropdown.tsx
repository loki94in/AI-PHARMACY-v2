import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows } from '../lib/theme';
import { SearchMedicineResult } from '../lib/api';

export interface CustomerResult {
  id?: number;
  name: string;
  phone?: string;
  address?: string;
}

interface UpwardSearchDropdownProps {
  visible: boolean;
  type: 'medicine' | 'customer';
  medicineResults?: SearchMedicineResult[];
  customerResults?: CustomerResult[];
  onSelectMedicine?: (item: SearchMedicineResult) => void;
  onSelectCustomer?: (item: CustomerResult) => void;
  onAddNewCustomer?: () => void;
  onClose?: () => void;
  maxHeight?: number;
}

export default function UpwardSearchDropdown({
  visible,
  type,
  medicineResults = [],
  customerResults = [],
  onSelectMedicine,
  onSelectCustomer,
  onAddNewCustomer,
  onClose,
  maxHeight = 280,
}: UpwardSearchDropdownProps) {
  if (!visible) return null;

  const hasMedicineItems = type === 'medicine' && medicineResults.length > 0;
  const hasCustomerItems = type === 'customer' && customerResults.length > 0;

  if (!hasMedicineItems && !hasCustomerItems && type !== 'customer') {
    return null;
  }

  return (
    <View style={[styles.container, shadows.card]}>
      {/* Header bar with count & close button */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons
            name={type === 'medicine' ? 'medkit' : 'people'}
            size={16}
            color={colors.primary}
          />
          <Text style={styles.headerTitleText}>
            {type === 'medicine'
              ? `Select Medicine (${medicineResults.length} found)`
              : `Select Customer (${customerResults.length} found)`}
          </Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={[styles.scrollArea, { maxHeight }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        {type === 'customer' && onAddNewCustomer && (
          <TouchableOpacity
            style={styles.addNewCustomerRow}
            onPress={onAddNewCustomer}
            activeOpacity={0.7}
          >
            <View style={styles.addNewIconContainer}>
              <Ionicons name="person-add" size={18} color="#fff" />
            </View>
            <Text style={styles.addNewCustomerText}>+ Add New Customer</Text>
          </TouchableOpacity>
        )}

        {type === 'medicine' &&
          medicineResults.map((item, index) => {
            const isOutOfStock = (item.quantity || 0) <= 0;
            const packSizeVal = (item as any).pack_size || (item as any).unit || '';

            return (
              <TouchableOpacity
                key={`med-${item.inventory_id || index}-${item.medicine_name}`}
                style={[
                  styles.itemRow,
                  isOutOfStock && styles.itemRowOutOfStock,
                ]}
                onPress={() => onSelectMedicine && onSelectMedicine(item)}
                activeOpacity={0.7}
              >
                <View style={styles.itemMainInfo}>
                  <Text style={styles.medicineName} numberOfLines={1}>
                    {item.medicine_name}
                  </Text>
                  <View style={styles.metaBadgeRow}>
                    {item.batch_no ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Batch: {item.batch_no}</Text>
                      </View>
                    ) : null}
                    {item.expiry_date ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Exp: {item.expiry_date}</Text>
                      </View>
                    ) : null}
                    {packSizeVal ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Pack: {packSizeVal}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={styles.itemPriceStockInfo}>
                  <Text style={styles.priceText}>
                    ₹{(item.mrp || item.unit_price || 0).toFixed(2)}
                  </Text>
                  <Text
                    style={[
                      styles.stockText,
                      isOutOfStock ? styles.stockOut : styles.stockIn,
                    ]}
                  >
                    {isOutOfStock ? 'Out of Stock' : `Stock: ${item.quantity}`}
                  </Text>
                </View>

                <Ionicons
                  name={isOutOfStock ? 'alert-circle' : 'add-circle'}
                  size={22}
                  color={isOutOfStock ? colors.warning : colors.primary}
                  style={styles.actionIcon}
                />
              </TouchableOpacity>
            );
          })}

        {type === 'customer' &&
          customerResults.map((cust, idx) => (
            <TouchableOpacity
              key={`cust-${cust.id || idx}-${cust.name}`}
              style={styles.itemRow}
              onPress={() => onSelectCustomer && onSelectCustomer(cust)}
              activeOpacity={0.7}
            >
              <View style={styles.customerAvatar}>
                <Ionicons name="person" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.customerNameText}>{cust.name}</Text>
                {cust.phone ? (
                  <Text style={styles.customerPhoneText}>📞 {cust.phone}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  closeBtn: {
    padding: 2,
  },
  scrollArea: {
    width: '100%',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  itemRowOutOfStock: {
    backgroundColor: colors.bg,
    opacity: 0.85,
  },
  itemMainInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  medicineName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  metaBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  badge: {
    backgroundColor: colors.bg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  badgeText: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  itemPriceStockInfo: {
    alignItems: 'flex-end',
    marginRight: spacing.sm,
  },
  priceText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  stockText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  stockIn: {
    color: colors.success,
  },
  stockOut: {
    color: colors.warning,
  },
  actionIcon: {
    marginLeft: spacing.sm,
  },
  addNewCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary + '15',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: spacing.sm,
  },
  addNewIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNewCustomerText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  customerNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  customerPhoneText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
});
