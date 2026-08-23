import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, spacing, typography, shadows } from '../../lib/theme';
import { resolveScan, attachBarcode, searchMedicine, type ScanResolution, type SearchMedicineResult } from '../../lib/api';
import { formatDateIN } from '../../lib/helpers';

const BARCODE_TYPES = ['qr', 'code128', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code39'] as const;

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanResolution | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Attach-to-medicine state (unknown manufacturer barcodes)
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<SearchMedicineResult[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkedMsg, setLinkedMsg] = useState('');

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (processing) return;
    const text = (data || '').trim();
    if (!text) return;

    setProcessing(true);
    setErrorMsg('');
    setResult(null);
    try {
      const resolution = await resolveScan(text);
      setResult(resolution);
      if (!resolution.success) {
        setErrorMsg('Code not recognized as a product or bill.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(
        message.includes('Server URL not configured') || message.startsWith('API ')
          ? 'Cannot reach the pharmacy PC server. Check the connection and try again.'
          : 'Failed to identify the scanned code.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const resetScan = () => {
    setResult(null);
    setErrorMsg('');
    setLinkQuery('');
    setLinkResults([]);
    setLinkedMsg('');
  };

  const handleLinkSearch = async (text: string) => {
    setLinkQuery(text);
    setLinkedMsg('');
    if (text.trim().length < 2) {
      setLinkResults([]);
      return;
    }
    try {
      const rows = await searchMedicine(text.trim());
      setLinkResults(rows.slice(0, 8));
    } catch {
      setLinkResults([]);
    }
  };

  const handleAttach = async (med: SearchMedicineResult) => {
    if (!result || result.type !== 'not_found' || linking) return;
    setLinking(true);
    try {
      const res = await attachBarcode(result.scannedText, med.medicine_id);
      setLinkedMsg(`✅ Saved — "${res.medicine_name}" now answers to this barcode.`);
      setLinkResults([]);
      setLinkQuery('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLinkedMsg(message.includes('already linked') ? message.replace(/^API \d+: /, '') : 'Could not save the code. Try again.');
    } finally {
      setLinking(false);
    }
  };

  const addToBill = async (item: {
    inventory_id: number;
    medicine_id: number;
    medicine_name: string;
    batch_no: string;
    expiry_date: string;
    quantity: number;
    mrp: number;
    unit_price: number;
    cost_price: number;
  }) => {
    try {
      const existing = await AsyncStorage.getItem('billing_cart_add_queue');
      const arr = existing ? JSON.parse(existing) : [];
      arr.push(item);
      await AsyncStorage.setItem('billing_cart_add_queue', JSON.stringify(arr));
      router.push('/(tabs)/billing');
    } catch {
      setErrorMsg('Could not add to bill. Try again.');
    }
  };

  // ── Permission states (same flow as ServerSetup) ─────────────────────────
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
        <Text style={[typography.body, { marginTop: spacing.md, textAlign: 'center' }]}>
          Camera access is required to scan medicine codes and bill QRs.
        </Text>
        <TouchableOpacity onPress={requestPermission} style={{ marginTop: spacing.lg }}>
          <Text style={styles.actionBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stockLabel = (q: number, lq: number) => {
    const total = (q || 0) + (lq || 0);
    return total > 0 ? `${total} in stock` : 'Out of stock';
  };

  const renderResult = () => {
    if (!result && !errorMsg && !processing) return null;

    return (
      <View style={[styles.resultSheet, shadows.card]}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          {processing && (
            <View style={styles.sheetRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[typography.body, { marginLeft: spacing.sm }]}>Identifying...</Text>
            </View>
          )}

          {!!errorMsg && (
            <View style={styles.sheetRow}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text style={[typography.body, { marginLeft: spacing.sm, flex: 1, color: colors.danger }]}>
                {errorMsg}
              </Text>
            </View>
          )}

          {result?.type === 'not_found' && !!result.attachable && (
            <>
              <View style={styles.sheetHeaderRow}>
                <Ionicons name="link-outline" size={20} color={colors.accent} />
                <Text style={styles.sheetTitle}>Attach this barcode</Text>
              </View>
              <Text style={styles.hintText}>
                No medicine uses "{result.scannedText}" yet. Search and select the medicine whose
                box carries this printed code — future scans will identify it instantly.
              </Text>
              <TextInput
                style={styles.linkInput}
                value={linkQuery}
                onChangeText={handleLinkSearch}
                placeholder="Search medicine name (min 2 letters)"
                placeholderTextColor={colors.textMuted}
              />
              {linkResults.map(m => (
                <TouchableOpacity
                  key={m.inventory_id || m.medicine_id}
                  style={styles.linkRow}
                  activeOpacity={0.7}
                  disabled={linking}
                  onPress={() => handleAttach(m)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medName}>{m.medicine_name}</Text>
                    <Text style={styles.medSub}>Batch: {m.batch_no || '-'} · MRP: ₹{Number(m.mrp || 0).toFixed(2)}</Text>
                  </View>
                  <Ionicons name="save-outline" size={18} color={colors.success} />
                </TouchableOpacity>
              ))}
              {linking && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: spacing.sm }} />}
              {!!linkedMsg && (
                <Text style={[styles.hintText, { color: linkedMsg.startsWith('✅') ? colors.success : colors.danger }]}>
                  {linkedMsg}
                </Text>
              )}
            </>
          )}

          {result?.type === 'sale_invoice' && result.invoice && (
            <>
              <View style={styles.sheetHeaderRow}>
                <Ionicons name="receipt-outline" size={20} color={colors.primary} />
                <Text style={styles.sheetTitle}>Sell Bill Identified</Text>
              </View>
              <Text style={styles.detailLine}>Invoice No: {result.invoice.invoice_no}</Text>
              {!!result.invoice.date && <Text style={styles.detailLine}>Date: {formatDateIN(String(result.invoice.date).split('T')[0])}</Text>}
              <Text style={styles.detailLine}>Customer: {result.invoice.customer_name || 'Walk-in'}</Text>
              {!!result.invoice.customer_phone && <Text style={styles.detailLine}>Phone: {result.invoice.customer_phone}</Text>}
              {!!result.invoice.payment_medium && <Text style={styles.detailLine}>Payment: {result.invoice.payment_medium}</Text>}
              <Text style={styles.detailTotal}>Total: ₹{Number(result.invoice.total_amount || 0).toFixed(2)}</Text>
              <Text style={styles.hintText}>Returns / reprint for PC bills are handled in the Sells History on the pharmacy PC.</Text>
            </>
          )}

          {result?.type === 'purchase_bill' && result.bill && (
            <>
              <View style={styles.sheetHeaderRow}>
                <Ionicons name="cube-outline" size={20} color={colors.warning} />
                <Text style={styles.sheetTitle}>Purchase Bill Identified</Text>
              </View>
              <Text style={styles.detailLine}>Bill No: {result.bill.invoice_no}</Text>
              {!!result.bill.date && <Text style={styles.detailLine}>Date: {formatDateIN(String(result.bill.date).split('T')[0])}</Text>}
              {!!result.bill.distributor_name && <Text style={styles.detailLine}>Distributor: {result.bill.distributor_name}</Text>}
              <Text style={styles.detailTotal}>Total: ₹{Number(result.bill.total_amount || 0).toFixed(2)}</Text>
            </>
          )}

          {result?.type === 'medicine' && Array.isArray(result.matches) && result.matches.length > 0 && (
            <>
              <View style={styles.sheetHeaderRow}>
                <Ionicons name="medkit-outline" size={20} color={colors.success} />
                <Text style={styles.sheetTitle}>
                  Medicine Identified{result.matches.length > 1 ? ` (${result.matches.length} batches)` : ''}
                </Text>
              </View>
              {result.matches.map((m, i) => (
                <View key={`${m.inventory_id}-${i}`} style={styles.medRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medName}>{m.medicine_name}</Text>
                    <Text style={styles.medSub}>
                      Batch: {m.batch_no || '-'} · Exp: {m.expiry_date ? formatDateIN(String(m.expiry_date)) : '-'}
                    </Text>
                    <Text style={styles.medSub}>
                      MRP: ₹{Number(m.mrp || 0).toFixed(2)} · {stockLabel(m.quantity, m.loose_quantity ?? 0)}
                    </Text>
                  </View>
                  {(Number(m.quantity) || 0) + (Number(m.loose_quantity) || 0) > 0 && (
                    <TouchableOpacity
                      style={styles.addBtn}
                      activeOpacity={0.8}
                      onPress={() =>
                        addToBill({
                          inventory_id: m.inventory_id,
                          medicine_id: m.medicine_id,
                          medicine_name: m.medicine_name,
                          batch_no: m.batch_no || '',
                          expiry_date: m.expiry_date || '',
                          quantity: m.quantity || 0,
                          mrp: Number(m.mrp || 0),
                          unit_price: Number(m.unit_price ?? m.mrp ?? 0),
                          cost_price: Number(m.cost_price || 0),
                        })
                      }
                    >
                      <Text style={styles.addBtnText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </>
          )}
        </ScrollView>

        <TouchableOpacity style={styles.scanAgainBtn} activeOpacity={0.8} onPress={resetScan}>
          <Ionicons name="scan-outline" size={16} color="#fff" />
          <Text style={styles.scanAgainText}>{result || errorMsg ? 'Scan Again' : 'Cancel'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchOn}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={processing ? undefined : handleBarcodeScanned}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.8}
            onPress={() => (result || errorMsg ? resetScan() : router.back())}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.torchBtn}
            activeOpacity={0.8}
            onPress={() => setTorchOn(v => !v)}
          >
            <Ionicons name={torchOn ? 'flash' : 'flash-outline'} size={22} color="#fff" />
          </TouchableOpacity>

          {!result && !errorMsg && !processing && (
            <>
              <View style={styles.frame} />
              <Text style={styles.hint}>Point at a product barcode/QR{'\n'}or a sell-bill code</Text>
            </>
          )}

          {renderResult()}
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 270,
    height: 190,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  hint: {
    ...typography.bodySmall,
    color: '#fff',
    marginTop: spacing.lg,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 25,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  torchBtn: {
    position: 'absolute',
    top: 50,
    left: 25,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  resultSheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    maxHeight: 520,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    flex: 1,
  },
  detailLine: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  detailTotal: {
    ...typography.body,
    fontWeight: '700',
    color: colors.success,
    marginTop: spacing.xs,
  },
  hintText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  linkInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginTop: spacing.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  medName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  medSub: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 1,
  },
  addBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  scanAgainBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  scanAgainText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
