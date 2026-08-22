import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, typography, radius } from '../../../lib/theme';
import {
  getPurchases,
  Purchase,
  uploadPurchaseBillPhoto,
  queueBillPhoto,
  getPendingBillPhotos,
  getScannedBillDrafts,
  removeScannedBillDraft,
  saveScannedBillDraft,
  queueOfflinePurchase,
  ScannedBillDraft,
  getServerUrl,
  testConnection,
} from '../../../lib/api';
import { formatDateIN } from '../../../lib/helpers';

interface DraftItem {
  name: string;
  quantity: number;
  price: number;
  mrp: number;
  batch_no?: string;
  expiry_date?: string;
}

export default function PurchasesScreen() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Scan bill state
  const [scanning, setScanning] = useState(false);
  const [pendingPhotoCount, setPendingPhotoCount] = useState(0);
  const [drafts, setDrafts] = useState<ScannedBillDraft[]>([]);

  // Review modal state
  const [reviewDraft, setReviewDraft] = useState<ScannedBillDraft | null>(null);
  const [reviewDist, setReviewDist] = useState('');
  const [reviewInvoiceNo, setReviewInvoiceNo] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [reviewItems, setReviewItems] = useState<DraftItem[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await getPurchases();
      setPurchases(data);
    } catch (e) {
      console.warn('Purchases fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadLocalState = useCallback(async () => {
    const [photos, draftsList] = await Promise.all([getPendingBillPhotos(), getScannedBillDrafts()]);
    setPendingPhotoCount(photos.length);
    setDrafts(draftsList);
  }, []);

  useEffect(() => {
    fetchData();
    loadLocalState();
  }, [fetchData, loadLocalState]);

  const openReviewModal = (draft: ScannedBillDraft) => {
    setReviewDraft(draft);
    setReviewDist(draft.parsed.distributor_name || '');
    setReviewInvoiceNo(draft.parsed.invoice_no || '');
    setReviewDate(draft.parsed.invoice_date || '');
    setReviewItems(
      (draft.parsed.data || []).map(it => ({
        name: it.name || '',
        quantity: Number(it.quantity) || 0,
        price: Number(it.price) || 0,
        mrp: Number(it.mrp) || 0,
        batch_no: it.batch_no || '',
        expiry_date: it.expiry_date || '',
      }))
    );
  };

  const handleScanBill = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to scan purchase bills.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const imageUri = result.assets[0].uri;

      setScanning(true);
      // Quick PC reachability probe; offline → queue photo for auto-upload later
      const url = await getServerUrl();
      const serverOnline = url ? await testConnection(url) : false;
      if (!serverOnline) {
        await queueBillPhoto(imageUri);
        await loadLocalState();
        Alert.alert(
          'Saved Offline',
          'PC not reachable. Photo queued — it will be OCR-scanned automatically when the PC is back on the same WiFi.'
        );
        return;
      }

      try {
        const parsed = await uploadPurchaseBillPhoto(imageUri);
        if (!parsed || !Array.isArray(parsed.data)) {
          throw new Error(parsed?.error || 'Could not read this bill');
        }
        const draft: ScannedBillDraft = {
          id: 'BILL-' + Date.now(),
          scanned_at: new Date().toISOString(),
          parsed: {
            distributor_name: parsed.distributor_name,
            invoice_no: parsed.invoice_no,
            invoice_date: parsed.invoice_date,
            total_amount: parsed.total_amount,
            data: parsed.data,
          },
        };
        await saveScannedBillDraft(draft);
        await loadLocalState();
        if (draft.parsed.data.length === 0) {
          Alert.alert('Scanned (empty)', 'OCR ran but no item rows were detected. The draft is saved for manual entry.');
        } else {
          openReviewModal(draft);
        }
      } catch (err: any) {
        // Network failure mid-capture → queue instead of losing the shot
        await queueBillPhoto(imageUri);
        await loadLocalState();
        Alert.alert('Queued', `Upload failed (${err.message || 'network'}). Photo queued for auto-sync.`);
      }
    } finally {
      setScanning(false);
    }
  };

  const updateReviewItem = (idx: number, field: keyof DraftItem, value: string) => {
    setReviewItems(prev =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        if (field === 'quantity' || field === 'price' || field === 'mrp') {
          return { ...it, [field]: parseFloat(value) || 0 };
        }
        return { ...it, [field]: value };
      })
    );
  };

  const handleSaveDraftAsPurchase = async () => {
    if (!reviewDraft) return;
    const validItems = reviewItems.filter(it => it.name.trim() && it.quantity > 0);
    if (validItems.length === 0) {
      Alert.alert('Empty', 'At least one item with a name and quantity is required.');
      return;
    }
    if (!reviewInvoiceNo.trim()) {
      Alert.alert('Required', 'Invoice number is required.');
      return;
    }
    setSavingDraft(true);
    try {
      await queueOfflinePurchase({
        distributor_name: reviewDist.trim() || 'Unknown Distributor',
        invoice_no: reviewInvoiceNo.trim(),
        invoice_date: reviewDate.trim() || new Date().toISOString().slice(0, 10),
        items: validItems.map(it => ({
          name: it.name.trim(),
          quantity: it.quantity,
          free_quantity: 0,
          price: it.price,
          mrp: it.mrp,
          batch_no: it.batch_no || '',
          expiry_date: it.expiry_date || '',
        })),
        source: 'Mobile Scan',
        saved_at: new Date().toISOString(),
      });
      await removeScannedBillDraft(reviewDraft.id);
      await loadLocalState();
      setReviewDraft(null);
      Alert.alert(
        'Queued for PC',
        'Purchase bill saved on the phone. It will sync to the PC purchase approvals when connected.'
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleDiscardDraft = (draft: ScannedBillDraft) => {
    Alert.alert('Discard Draft', 'Remove this scanned bill without saving?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await removeScannedBillDraft(draft.id);
          await loadLocalState();
        },
      },
    ]);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      {/* Scan Bill header button */}
      <TouchableOpacity style={styles.scanBtn} onPress={handleScanBill} disabled={scanning}>
        <Ionicons name="camera" size={18} color="#fff" />
        <Text style={styles.scanBtnText}>{scanning ? 'Reading bill...' : 'Scan Paper Bill (OCR)'}</Text>
      </TouchableOpacity>

      {(pendingPhotoCount > 0 || drafts.length > 0) && (
        <View style={styles.statusRow}>
          {pendingPhotoCount > 0 && (
            <View style={[styles.statusChip, { borderColor: colors.warning + '55', backgroundColor: colors.warning + '15' }]}>
              <Ionicons name="time" size={11} color={colors.warning} />
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.warning }}>
                {pendingPhotoCount} photo{pendingPhotoCount !== 1 ? 's' : ''} queued
              </Text>
            </View>
          )}
          {drafts.length > 0 && (
            <View style={[styles.statusChip, { borderColor: colors.info + '55', backgroundColor: colors.info + '15' }]}>
              <Ionicons name="document-text" size={11} color={colors.info} />
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.info }}>{drafts.length} draft{drafts.length !== 1 ? 's' : ''} to review</Text>
            </View>
          )}
        </View>
      )}

      {/* Drafts awaiting review */}
      {drafts.length > 0 && (
        <View style={styles.draftsSection}>
          <Text style={styles.sectionLabel}>SCANNED DRAFTS</Text>
          {drafts.map(d => (
            <View key={d.id} style={styles.draftCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.draftTitle} numberOfLines={1}>
                  {d.parsed.invoice_no || 'No invoice #'} · {d.parsed.distributor_name || 'Unknown'}
                </Text>
                <Text style={styles.draftMeta}>
                  {d.parsed.data.length} item{d.parsed.data.length !== 1 ? 's' : ''} · scanned {formatDateIN(d.scanned_at)}
                </Text>
              </View>
              <TouchableOpacity style={styles.reviewBtn} onPress={() => openReviewModal(d)}>
                <Text style={styles.reviewBtnText}>Review</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDiscardDraft(d)} style={{ padding: 6 }}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={purchases}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.invoiceBadge}>
                <Ionicons name="document-text-outline" size={14} color={colors.primary} />
                <Text style={styles.invoiceText}>{item.invoice_no || 'N/A'}</Text>
              </View>
              <Text style={styles.amount}>₹{Number(item.total_amount || 0).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.cardBottom}>
              <View style={styles.metaItem}>
                <Ionicons name="business-outline" size={14} color={colors.textMuted} />
                <Text style={styles.metaText}>{item.distributor_name || 'Unknown'}</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                <Text style={styles.metaText}>{formatDateIN(item.date)}</Text>
              </View>
            </View>
          </View>
        )}
        ListHeaderComponent={
          purchases.length > 0 ? (
            <Text style={styles.sectionLabel}>PURCHASE HISTORY</Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={[typography.bodySmall, { marginTop: spacing.md }]}>No purchases found</Text>
          </View>
        }
      />

      {/* MODAL: REVIEW SCANNED BILL */}
      <Modal visible={!!reviewDraft} transparent animationType="slide" onRequestClose={() => setReviewDraft(null)}>
        <View style={styles.modalOverlayFull}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHeader}>
              <Text style={typography.h3}>Verify Scanned Bill</Text>
              <TouchableOpacity onPress={() => setReviewDraft(null)}>
                <Ionicons name="close-circle" size={26} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>DISTRIBUTOR</Text>
              <TextInput style={styles.input} value={reviewDist} onChangeText={setReviewDist} placeholderTextColor={colors.textMuted} placeholder="Distributor name" />

              <View style={{ flexDirection: 'row', gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>INVOICE NO *</Text>
                  <TextInput style={styles.input} value={reviewInvoiceNo} onChangeText={setReviewInvoiceNo} placeholderTextColor={colors.textMuted} placeholder="Inv #" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>DATE (YYYY-MM-DD)</Text>
                  <TextInput style={styles.input} value={reviewDate} onChangeText={setReviewDate} placeholderTextColor={colors.textMuted} placeholder="2026-01-31" />
                </View>
              </View>

              <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>ITEMS ({reviewItems.length}) — fix any OCR mistakes</Text>
              {reviewItems.map((it, idx) => (
                <View key={`ri-${idx}`} style={styles.itemEditCard}>
                  <TextInput
                    style={[styles.input, { fontWeight: '700' }]}
                    value={it.name}
                    onChangeText={v => updateReviewItem(idx, 'name', v)}
                    placeholder="Medicine name"
                    placeholderTextColor={colors.textMuted}
                  />
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput style={[styles.inputSmall, { flex: 1 }]} value={String(it.quantity)} onChangeText={v => updateReviewItem(idx, 'quantity', v)} keyboardType="numeric" placeholder="Qty" placeholderTextColor={colors.textMuted} />
                    <TextInput style={[styles.inputSmall, { flex: 1 }]} value={String(it.price)} onChangeText={v => updateReviewItem(idx, 'price', v)} keyboardType="numeric" placeholder="Rate" placeholderTextColor={colors.textMuted} />
                    <TextInput style={[styles.inputSmall, { flex: 1 }]} value={String(it.mrp)} onChangeText={v => updateReviewItem(idx, 'mrp', v)} keyboardType="numeric" placeholder="MRP" placeholderTextColor={colors.textMuted} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput style={[styles.inputSmall, { flex: 1 }]} value={it.batch_no || ''} onChangeText={v => updateReviewItem(idx, 'batch_no', v)} placeholder="Batch" placeholderTextColor={colors.textMuted} />
                    <TextInput style={[styles.inputSmall, { flex: 1 }]} value={it.expiry_date || ''} onChangeText={v => updateReviewItem(idx, 'expiry_date', v)} placeholder="Exp MM/YY" placeholderTextColor={colors.textMuted} />
                  </View>
                  <TouchableOpacity
                    style={{ alignSelf: 'flex-end', padding: 3 }}
                    onPress={() => setReviewItems(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveDraftAsPurchase} disabled={savingDraft}>
              {savingDraft ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="save" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}>Save to Phone Queue</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  scanBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  statusRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
  },

  sectionLabel: {
    ...typography.caption,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
  },

  draftsSection: { marginBottom: 4 },
  draftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.info + '44',
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    marginHorizontal: spacing.md,
    marginBottom: 4,
  },
  draftTitle: { fontSize: 12.5, fontWeight: '700', color: colors.textPrimary },
  draftMeta: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  reviewBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reviewBtnText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  invoiceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.shimmer, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm },
  invoiceText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  amount: { ...typography.h3, color: colors.accent },
  cardBottom: { flexDirection: 'row', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...typography.caption },

  modalOverlayFull: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '92%',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 3,
    marginTop: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 5,
  },
  inputSmall: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 6,
    fontSize: 12,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  itemEditCard: {
    backgroundColor: colors.surface + '66',
    borderRadius: radius.sm,
    padding: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.success,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
