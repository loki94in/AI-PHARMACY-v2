import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { colors, spacing, typography, radius, shadows } from '../../../lib/theme';
import { searchMedicine, createSale, SearchMedicineResult } from '../../../lib/api';
import { cartEvents } from '../../../lib/cartEvents';
import SearchBar from '../../../components/SearchBar';
import CartItem from '../../../components/CartItem';

interface CartEntry extends SearchMedicineResult {
  cart_qty: number;
}

export default function BillingScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMedicineResult[]>([]);
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<{ invoice_no: string; total: number } | null>(null);

  useEffect(() => {
    const unsubscribe = cartEvents.subscribe((item: any, quantity: number) => {
      setCart(currentCart => {
        const existing = currentCart.find(c => c.inventory_id === item.inventory_id);
        if (existing) {
          return currentCart.map(c => c.inventory_id === item.inventory_id ? { ...c, cart_qty: c.cart_qty + quantity } : c);
        } else {
          return [...currentCart, { ...item, cart_qty: quantity }];
        }
      });
    });
    return unsubscribe;
  }, []);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (text.length < 2) { setResults([]); return; }
    try {
      const data = await searchMedicine(text);
      setResults(data);
    } catch { setResults([]); }
  }, []);

  const addToCart = (item: SearchMedicineResult) => {
    const existing = cart.find(c => c.inventory_id === item.inventory_id);
    if (existing) {
      setCart(cart.map(c => c.inventory_id === item.inventory_id ? { ...c, cart_qty: c.cart_qty + 1 } : c));
    } else {
      setCart([...cart, { ...item, cart_qty: 1 }]);
    }
    setQuery('');
    setResults([]);
  };

  const updateQty = (inventoryId: number, qty: number) => {
    setCart(cart.map(c => c.inventory_id === inventoryId ? { ...c, cart_qty: qty } : c));
  };

  const removeItem = (inventoryId: number) => {
    setCart(cart.filter(c => c.inventory_id !== inventoryId));
  };

  const cartTotal = cart.reduce((sum, c) => sum + Number(c.cart_qty || 0) * Number(c.mrp || c.unit_price || 0), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) { Alert.alert('Empty Cart', 'Add medicines to cart first.'); return; }
    setSubmitting(true);
    try {
      const res = await createSale({
        items: cart.map(c => ({
          inventory_id: c.inventory_id,
          quantity: Number(c.cart_qty || 0),
          unit_price: Number(c.mrp || c.unit_price || 0)
        })),
        patient_name: patientName || undefined,
        patient_phone: patientPhone || undefined,
      });
      setInvoiceResult({ invoice_no: res.invoice_no, total: res.total });
      
      // Trigger local notification to display global Toast and save to alert history
      Notifications.scheduleNotificationAsync({
        content: {
          title: '⚡ Bill Saved Successfully',
          body: `Invoice ${res.invoice_no} created for ₹${res.total.toFixed(2)} (${patientName || 'Walk-in Customer'}).`,
        },
        trigger: null,
      }).catch(err => console.warn('Failed to trigger bill notification:', err));

      setCart([]);
      setPatientName('');
      setPatientPhone('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create sale');
    } finally {
      setSubmitting(false);
    }
  };

  if (invoiceResult) {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        </View>
        <Text style={typography.h2}>Sale Complete!</Text>
        <Text style={[typography.body, { marginTop: spacing.sm }]}>Invoice: {invoiceResult.invoice_no}</Text>
        <Text style={[typography.h3, { color: colors.accent, marginTop: spacing.sm }]}>₹{invoiceResult.total.toFixed(2)}</Text>
        <TouchableOpacity style={styles.newBillBtn} onPress={() => setInvoiceResult(null)}>
          <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.newBillGradient}>
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
            <Text style={styles.newBillText}>New Bill</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Search */}
        <SearchBar value={query} onChangeText={handleSearch} placeholder="Search medicine by name, batch, MRP..." />

        {/* Search Results */}
        {results.length > 0 && (
          <View style={styles.resultsList}>
            {results.slice(0, 8).map((item) => (
              <TouchableOpacity key={item.inventory_id} style={styles.resultRow} onPress={() => addToCart(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={typography.body} numberOfLines={1}>{item.medicine_name}</Text>
                  <Text style={typography.caption}>Batch: {item.batch_no} | Stock: {item.quantity} | MRP: ₹{item.mrp || item.unit_price}</Text>
                </View>
                <Ionicons name="add-circle" size={24} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Customer Info */}
        <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>CUSTOMER</Text>
        <View style={styles.customerRow}>
          <TextInput style={[styles.customerInput, { flex: 2 }]} value={patientName} onChangeText={setPatientName} placeholder="Name" placeholderTextColor={colors.textMuted} />
          <TextInput style={[styles.customerInput, { flex: 1 }]} value={patientPhone} onChangeText={setPatientPhone} placeholder="Phone" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />
        </View>

        {/* Cart */}
        <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>
          CART ({cart.length} items)
        </Text>
        {cart.length === 0 ? (
          <View style={styles.emptyCart}>
            <Ionicons name="cart-outline" size={40} color={colors.textMuted} />
            <Text style={[typography.bodySmall, { marginTop: spacing.sm }]}>Search & add medicines above</Text>
          </View>
        ) : (
          cart.map((item) => (
            <CartItem
              key={item.inventory_id}
              name={item.medicine_name}
              batch={item.batch_no}
              qty={item.cart_qty}
              price={item.mrp || item.unit_price || 0}
              onQtyChange={(q) => updateQty(item.inventory_id, q)}
              onRemove={() => removeItem(item.inventory_id)}
            />
          ))
        )}
      </ScrollView>

      {/* Checkout Bar */}
      {cart.length > 0 && (
        <View style={styles.checkoutBar}>
          <View>
            <Text style={typography.caption}>TOTAL</Text>
            <Text style={[typography.h2, { color: colors.accent }]}>₹{cartTotal.toFixed(2)}</Text>
          </View>
          <TouchableOpacity onPress={handleCheckout} disabled={submitting} activeOpacity={0.8}>
            <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.checkoutBtn}>
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={styles.checkoutText}>{submitting ? 'Processing...' : 'Checkout'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 100 },
  successContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  successIcon: { marginBottom: spacing.lg },
  newBillBtn: { marginTop: spacing.xl },
  newBillGradient: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 14, paddingHorizontal: spacing.xl, borderRadius: radius.md },
  newBillText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  resultsList: { backgroundColor: colors.surface, borderRadius: radius.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  customerRow: { flexDirection: 'row', gap: spacing.sm },
  customerInput: { backgroundColor: colors.surfaceLight, borderRadius: radius.md, padding: spacing.md, fontSize: 14, color: colors.textPrimary, borderWidth: 1, borderColor: colors.cardBorder },
  emptyCart: { alignItems: 'center', padding: spacing.xl },
  checkoutBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider,
    padding: spacing.md, paddingBottom: spacing.lg,
  },
  checkoutBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  checkoutText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
