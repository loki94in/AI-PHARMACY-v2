import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, radius } from '../../lib/theme';
import { getProductTrace } from '../../lib/api';
import SearchBar from '../../components/SearchBar';
import Card from '../../components/Card';

export default function ProductSearchScreen() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<{ purchases: any[]; sales: any[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const result = await getProductTrace(query);
      setData(result);
    } catch (e) {
      console.warn('Product trace error:', e);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Medicine name, batch, invoice..." style={{ flex: 1 }} />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Ionicons name="search" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: spacing.xl }} size="large" color={colors.primary} />}

      {data && !loading && (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Purchases Section */}
          <Text style={[typography.label, { marginBottom: spacing.sm }]}>
            PURCHASES ({data.purchases.length})
          </Text>
          {data.purchases.length === 0 ? (
            <Text style={[typography.bodySmall, { marginBottom: spacing.lg }]}>No purchase records found</Text>
          ) : (
            data.purchases.map((p: any, i: number) => (
              <Card key={`p-${i}`} style={styles.traceCard}>
                <Text style={styles.traceName}>{p.medicine_name}</Text>
                <View style={styles.traceRow}>
                  <Text style={typography.caption}>Invoice: {p.invoice_no}</Text>
                  <Text style={typography.caption}>{formatDate(p.transaction_date)}</Text>
                </View>
                <View style={styles.traceRow}>
                  <Text style={typography.bodySmall}>Batch: {p.batch_no || '-'}</Text>
                  <Text style={typography.bodySmall}>Qty: {p.quantity}</Text>
                  <Text style={[typography.bodySmall, { color: colors.info }]}>Cost: ₹{p.cost_price || 0}</Text>
                </View>
                <Text style={[typography.caption, { marginTop: 4 }]}>Distributor: {p.distributor_name || '-'}</Text>
              </Card>
            ))
          )}

          {/* Sales Section */}
          <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>
            SALES ({data.sales.length})
          </Text>
          {data.sales.length === 0 ? (
            <Text style={typography.bodySmall}>No sale records found</Text>
          ) : (
            data.sales.map((s: any, i: number) => (
              <Card key={`s-${i}`} style={styles.traceCard}>
                <Text style={styles.traceName}>{s.medicine_name}</Text>
                <View style={styles.traceRow}>
                  <Text style={typography.caption}>Invoice: {s.invoice_no}</Text>
                  <Text style={typography.caption}>{formatDate(s.transaction_date)}</Text>
                </View>
                <View style={styles.traceRow}>
                  <Text style={typography.bodySmall}>Batch: {s.batch_no || '-'}</Text>
                  <Text style={typography.bodySmall}>Qty: {s.quantity}</Text>
                  <Text style={[typography.bodySmall, { color: colors.accent }]}>MRP: ₹{s.unit_price || s.mrp || 0}</Text>
                </View>
                {s.customer_name && <Text style={[typography.caption, { marginTop: 4 }]}>Customer: {s.customer_name}</Text>}
              </Card>
            ))
          )}
        </ScrollView>
      )}

      {!data && !loading && (
        <View style={styles.empty}>
          <Ionicons name="git-compare-outline" size={48} color={colors.textMuted} />
          <Text style={[typography.bodySmall, { marginTop: spacing.md, textAlign: 'center' }]}>
            Search by medicine name, batch number, invoice, or distributor to trace product lifecycle
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  searchBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  traceCard: { marginBottom: spacing.sm },
  traceName: { ...typography.body, fontWeight: '700', marginBottom: 4 },
  traceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
