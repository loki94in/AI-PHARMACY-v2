import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, radius } from '../../../lib/theme';
import {
  getRefillsPanel,
  toggleRefillPause,
  cancelRefill,
  deleteRefill,
  updateRefillFrequency,
  fulfillRefill,
  fulfillAllRefills,
  sendRefillReminderNow,
  updatePatientProfile,
  deletePatientRefills,
  RefillPatientGroup,
  RefillMedicine,
  SearchMedicineResult,
} from '../../../lib/api';
import { stockLevel } from '../../../lib/stock';

const REFILL_CACHE_KEY = 'cached_refill_panel';

export default function RefillsScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<RefillPatientGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Frequency editor
  const [freqTarget, setFreqTarget] = useState<RefillMedicine | null>(null);
  const [freqDays, setFreqDays] = useState('30');

  // Patient profile editor
  const [editPatient, setEditPatient] = useState<RefillPatientGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const loadPanel = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await getRefillsPanel();
      setGroups(data);
      await AsyncStorage.setItem(REFILL_CACHE_KEY, JSON.stringify(data)).catch(() => {});
    } catch {
      try {
        const cached = await AsyncStorage.getItem(REFILL_CACHE_KEY);
        if (cached && showSpinner) setGroups(JSON.parse(cached));
      } catch {}
    } finally {
      if (showSpinner) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Instant paint from cache, then silent refresh (module contract)
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(REFILL_CACHE_KEY);
        if (cached) {
          setGroups(JSON.parse(cached));
          setLoading(false);
        }
      } catch {}
    })();
    loadPanel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withBusy = async (key: string, fn: () => Promise<any>) => {
    setBusyId(key);
    try {
      await fn();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleTogglePause = (med: RefillMedicine) =>
    withBusy(`m-${med.id}`, async () => {
      await toggleRefillPause(med.id);
      loadPanel();
    });

  const handleFulfill = (med: RefillMedicine) =>
    withBusy(`m-${med.id}`, async () => {
      await fulfillRefill(med.id);
      loadPanel();
    });

  const handleCancelMed = (med: RefillMedicine) => {
    Alert.alert('Cancel Refill Medicine', `Stop tracking "${med.medicine_name}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Medicine',
        style: 'destructive',
        onPress: () =>
          withBusy(`m-${med.id}`, async () => {
            await cancelRefill(med.id);
            loadPanel();
          }),
      },
    ]);
  };

  const handleDeleteMed = (med: RefillMedicine) => {
    Alert.alert('Delete Refill Entry', `Permanently delete "${med.medicine_name}" from this patient's cycle?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          withBusy(`m-${med.id}`, async () => {
            await deleteRefill(med.id);
          }).then(() => loadPanel()),
      },
    ]);
  };

  const handleSaveFrequency = () =>
    withBusy('freq', async () => {
      if (!freqTarget) return;
      const days = parseInt(freqDays, 10);
      if (!days || days <= 0) {
        Alert.alert('Invalid', 'Enter a valid number of days');
        return;
      }
      await updateRefillFrequency(freqTarget.id, days);
      setFreqTarget(null);
      loadPanel();
    });

  const handleSavePatient = () =>
    withBusy('patient', async () => {
      if (!editPatient) return;
      if (!editName.trim() || !editPhone.trim()) {
        Alert.alert('Required', 'Patient name and phone are required');
        return;
      }
      await updatePatientProfile({
        customer_id: editPatient.customer_id ?? undefined,
        original_phone: editPatient.patient_phone,
        patient_name: editName.trim(),
        patient_phone: editPhone.trim(),
        language: editPatient.language || 'en',
        next_refill_date: editPatient.next_refill_date,
      });
      setEditPatient(null);
      loadPanel();
    });

  const handleRemindNow = (group: RefillPatientGroup) =>
    withBusy(`remind-${group.patient_phone}`, async () => {
      await sendRefillReminderNow(group.patient_phone);
      Alert.alert('Reminder Sent', `WhatsApp reminder queued for ${group.patient_name}.`);
      loadPanel();
    });

  const handleCompleteAll = (group: RefillPatientGroup) =>
    withBusy(`all-${group.patient_phone}`, async () => {
      await fulfillAllRefills(group.patient_phone);
      loadPanel();
    });

  const handleSellNow = (group: RefillPatientGroup) => {
    const sellable = group.medicines.filter(
      m => m.is_active !== 0 && (m.inventory_id || m.in_stock_qty > 0)
    );
    if (sellable.length === 0) {
      Alert.alert('Nothing in Stock', 'None of this patient\u2019s refill medicines currently have stock batches.');
      return;
    }
    const items: SearchMedicineResult[] = sellable.map(m => ({
      inventory_id: m.inventory_id || 0,
      medicine_id: m.medicine_id,
      medicine_name: m.medicine_name,
      batch_no: m.batch_no || '',
      expiry_date: m.expiry_date || '',
      quantity: m.in_stock_qty || 0,
      mrp: m.mrp || m.unit_price || 0,
      unit_price: m.unit_price || m.mrp || 0,
      cost_price: 0,
    }));
    AsyncStorage.setItem('billing_cart_add_queue', JSON.stringify(items))
      .then(() => router.push('/(tabs)/billing'))
      .catch(() => {});
  };

  const handleEditPatient = (group: RefillPatientGroup) => {
    setEditName(group.patient_name);
    setEditPhone(group.patient_phone);
    setEditPatient(group);
  };

  const handleDeletePatient = (group: RefillPatientGroup) => {
    Alert.alert(
      'Delete Patient',
      `Remove ${group.patient_name} and all their refill cycles? This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            withBusy(`del-${group.patient_phone}`, async () => {
              await deletePatientRefills(group.patient_phone);
              loadPanel();
            }),
        },
      ]
    );
  };

  const renderMedicine = (med: RefillMedicine) => {
    const level = stockLevel((med.in_stock_qty || 0));
    const paused = med.is_active === 0;
    return (
      <View key={`med-${med.id}`} style={[styles.medRow, paused && styles.medRowPaused]}>
        <View style={[styles.stockDot, { backgroundColor: level.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.medName} numberOfLines={1}>
            {med.medicine_name}
          </Text>
          <Text style={styles.medMeta}>
            x{med.quantity_needed} · every {med.refill_interval_days}d · stock {med.in_stock_qty || 0}
            {paused ? ' · PAUSED' : ''}
          </Text>
        </View>
        {busyId === `m-${med.id}` ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View style={styles.medActions}>
            <IconBtn icon={paused ? 'play' : 'pause'} color={colors.warning} onPress={() => handleTogglePause(med)} />
            <IconBtn icon="calendar" color={colors.info} onPress={() => { setFreqTarget(med); setFreqDays(String(med.refill_interval_days || 30)); }} />
            {!paused && <IconBtn icon="checkmark" color={colors.success} onPress={() => handleFulfill(med)} />}
            <IconBtn icon="close" color={colors.danger} onPress={() => handleCancelMed(med)} />
            <IconBtn icon="trash-outline" color={colors.danger} onPress={() => handleDeleteMed(med)} />
          </View>
        )}
      </View>
    );
  };

  const renderGroup = (group: RefillPatientGroup) => {
    const activeMeds = group.medicines.filter(m => m.is_active !== 0);
    const dueSoon = group.next_refill_date;
    const remindBusy = busyId === `remind-${group.patient_phone}`;
    const allBusy = busyId === `all-${group.patient_phone}`;
    return (
      <View key={`grp-${group.patient_phone}`} style={styles.groupCard}>
        {/* Patient header */}
        <View style={styles.groupHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.patientName}>{group.patient_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Ionicons name="call" size={10} color={colors.textMuted} />
              <Text style={styles.patientMeta}>{group.patient_phone}</Text>
              <View style={styles.dateChip}>
                <Ionicons name="calendar-outline" size={9} color={colors.accent} />
                <Text style={styles.dateChipText}>{dueSoon}</Text>
              </View>
              {group.reminder_status === 'SENT' && (
                <View style={[styles.statusChip, { borderColor: colors.success + '55', backgroundColor: colors.success + '18' }]}>
                  <Text style={[styles.statusChipText, { color: colors.success }]}>WA SENT</Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity onPress={() => handleEditPatient(group)} style={styles.editBtn}>
            <Ionicons name="create-outline" size={15} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Medicines */}
        <View style={{ marginTop: 6 }}>{group.medicines.map(renderMedicine)}</View>

        {/* Patient-level actions */}
        <View style={styles.groupActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}
            onPress={() => handleRemindNow(group)}
            disabled={remindBusy}
          >
            {remindBusy ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <>
                <Ionicons name="logo-whatsapp" size={13} color={colors.success} />
                <Text style={[styles.actionText, { color: colors.success }]}>Remind Now</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '44' }]}
            onPress={() => handleSellNow(group)}
          >
            <Ionicons name="cart" size={13} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>Sell ({activeMeds.length})</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '44' }]}
            onPress={() => handleCompleteAll(group)}
            disabled={allBusy}
          >
            {allBusy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={13} color={colors.accent} />
                <Text style={[styles.actionText, { color: colors.accent }]}>Complete All</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.danger + '12', borderColor: colors.danger + '33' }]}
            onPress={() => handleDeletePatient(group)}
          >
            <Ionicons name="person-remove-outline" size={13} color={colors.danger} />
            <Text style={[styles.actionText, { color: colors.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading refill cycles...</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="repeat-outline" size={40} color={colors.textMuted} />
          <Text style={styles.stateText}>No refill patients yet{'\n'}Create them from PC CRM or POS sales</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPanel(); }} tintColor={colors.primary} />
          }
        >
          {groups.map(renderGroup)}
        </ScrollView>
      )}

      {/* MODAL: EDIT FREQUENCY */}
      <Modal visible={!!freqTarget} transparent animationType="fade" onRequestClose={() => setFreqTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Refill Cycle Days</Text>
            <Text style={styles.modalSubtitle}>{freqTarget?.medicine_name}</Text>
            <TextInput
              style={styles.textInput}
              value={freqDays}
              onChangeText={setFreqDays}
              keyboardType="numeric"
              placeholder="e.g. 30"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]} onPress={() => setFreqTarget(null)}>
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={handleSaveFrequency}>
                <Text style={styles.modalBtnTextPrimary}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: EDIT PATIENT PROFILE */}
      <Modal visible={!!editPatient} transparent animationType="fade" onRequestClose={() => setEditPatient(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Patient</Text>
            <TextInput
              style={styles.textInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Patient name"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.textInput}
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
              placeholder="Phone"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]} onPress={() => setEditPatient(null)}>
                <Text style={styles.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={handleSavePatient}>
                <Text style={styles.modalBtnTextPrimary}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function IconBtn({ icon, color, onPress }: { icon: any; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.iconBtn} activeOpacity={0.7}>
      <Ionicons name={icon} size={14} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.sm, paddingBottom: 40 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  stateText: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 },

  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  patientName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  patientMeta: { fontSize: 11, color: colors.textMuted },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent + '14',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  dateChipText: { fontSize: 9, fontWeight: '700', color: colors.accent },
  statusChip: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: radius.sm, borderWidth: 1 },
  statusChipText: { fontSize: 8, fontWeight: '800' },
  editBtn: { padding: 5 },

  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 7,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  medRowPaused: { opacity: 0.55 },
  stockDot: { width: 8, height: 8, borderRadius: 8 },
  medName: { fontSize: 12.5, fontWeight: '700', color: colors.textPrimary },
  medMeta: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  medActions: { flexDirection: 'row', gap: 3 },
  iconBtn: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  groupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  actionText: { fontSize: 11, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: spacing.md },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.cardBorder },
  modalTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
  modalSubtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  textInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  modalRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' },
  modalBtnTextPrimary: { fontSize: 13, fontWeight: '700', color: '#fff' },
  modalBtnTextSecondary: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
});
