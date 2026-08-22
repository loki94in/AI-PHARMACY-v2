import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from '../../lib/secureStore';
import { colors, spacing, typography, radius } from '../../lib/theme';
import {
  getRegisteredDevices,
  renameDevice,
  setDeviceBlocked,
  getDeviceLogs,
  clearDeviceLogs,
  RegisteredDevice,
  DeviceLogRow,
} from '../../lib/api';

function timeAgo(seconds?: number | null): string {
  if (seconds == null || !isFinite(seconds)) return 'unknown';
  if (seconds < 15) return 'now';
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function DevicesScreen() {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [logs, setLogs] = useState<DeviceLogRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ownUuid, setOwnUuid] = useState<string | null>(null);

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<RegisteredDevice | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [devs, logRows] = await Promise.all([getRegisteredDevices(), getDeviceLogs()]);
      setDevices(devs);
      setLogs(logRows);
    } catch {
      // keep previous data on failure
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setOwnUuid(await SecureStore.getItemAsync('admin_device_uuid'));
    })();
    load();
  }, [load]);

  const isOwn = (d: RegisteredDevice) => !!ownUuid && d.device_id === ownUuid;

  const openRename = (d: RegisteredDevice) => {
    if (!isOwn(d)) {
      Alert.alert('Other Device', 'Renaming is only allowed for the device you are holding.');
      return;
    }
    setNewName(d.device_name || '');
    setRenameTarget(d);
  };

  const handleSaveRename = async () => {
    if (!renameTarget) return;
    const clean = newName.trim();
    if (!clean) {
      Alert.alert('Required', 'Enter a device name');
      return;
    }
    setSaving(true);
    try {
      await renameDevice(renameTarget.token, clean);
      setRenameTarget(null);
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Rename failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBlock = (d: RegisteredDevice) => {
    const blocking = d.is_blocked !== 1;
    Alert.alert(
      blocking ? 'Block Device' : 'Unblock Device',
      blocking
        ? `"${d.device_name}" will be refused connection to the pharmacy PC until unblocked.`
        : `"${d.device_name}" will be allowed to connect again on its next ping.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: blocking ? 'Block' : 'Unblock',
          style: blocking ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await setDeviceBlocked(d.token, blocking);
              load();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Action failed');
            }
          },
        },
      ]
    );
  };

  const handleClearLogs = () => {
    Alert.alert('Clear History', 'Delete all connection history entries?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearDeviceLogs().catch(() => {});
          load();
        },
      },
    ]);
  };

  const renderDevice = (d: RegisteredDevice) => {
    const online = d.is_online === 1;
    const own = isOwn(d);
    const blocked = d.is_blocked === 1;
    const osLabel = d.os === 'ios' ? 'Apple' : d.os === 'android' ? 'Android' : d.os || 'Unknown';
    return (
      <TouchableOpacity
        key={d.token}
        style={[styles.deviceRow, (!online || blocked) && styles.deviceRowOffline, blocked && styles.deviceRowBlocked]}
        activeOpacity={own ? 0.7 : 0.95}
        onPress={() => own && openRename(d)}
      >
        <View style={styles.osIconWrap}>
          <Ionicons
            name={d.os === 'ios' ? 'logo-apple' : d.os === 'android' ? 'logo-android' : 'phone-portrait-outline'}
            size={18}
            color={d.os === 'android' ? '#3DDC84' : d.os === 'ios' ? colors.textPrimary : colors.textMuted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {d.device_name || 'Unnamed Terminal'}
            </Text>
            {own && (
              <View style={styles.ownChip}>
                <Text style={styles.ownChipText}>THIS DEVICE</Text>
              </View>
            )}
            {blocked && (
              <View style={styles.blockedChip}>
                <Text style={styles.blockedChipText}>BLOCKED</Text>
              </View>
            )}
          </View>
          <Text style={styles.deviceMeta}>
            {blocked
              ? 'Refused at connection'
              : `${osLabel} · ${online ? 'online' : `last seen ${timeAgo(d.offline_seconds)}`}`}
          </Text>
        </View>
        {!blocked && <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.textMuted }]} />}
        {own && !blocked && <Ionicons name="create-outline" size={14} color={colors.textMuted} />}
        <TouchableOpacity
          onPress={() => handleToggleBlock(d)}
          style={[styles.blockBtn, blocked && styles.unblockBtn]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name={blocked ? 'lock-open' : 'ban'} size={13} color={blocked ? colors.success : colors.danger} />
          <Text style={[styles.blockBtnText, { color: blocked ? colors.success : colors.danger }]}>
            {blocked ? 'Unblock' : 'Block'}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderLog = (log: DeviceLogRow) => {
    const connected = log.status === 'connected';
    return (
      <View key={`log-${log.id}`} style={styles.logRow}>
        <Ionicons
          name={connected ? 'arrow-up-circle' : 'arrow-down-circle'}
          size={15}
          color={connected ? colors.success : colors.warning}
        />
        <View style={{ flex: 1, marginLeft: 7 }}>
          <Text style={styles.logText} numberOfLines={1}>
            {log.device_name} {connected ? 'connected' : 'disconnected'}
          </Text>
          <Text style={styles.logTime}>{log.timestamp}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* Section: Devices */}
        <View style={styles.sectionHeaderRow}>
          <Text style={typography.label}>REGISTERED DEVICES</Text>
          <Text style={styles.hintLink}>Tap your device to rename</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
        ) : devices.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="phone-portrait-outline" size={30} color={colors.textMuted} />
            <Text style={styles.emptyText}>No devices registered yet.{'\n'}Connect a phone to this PC first.</Text>
          </View>
        ) : (
          devices.map(renderDevice)
        )}

        {/* Section: Connection history */}
        <View style={styles.sectionHeaderRow}>
          <Text style={typography.label}>CONNECTION HISTORY</Text>
          {logs.length > 0 && (
            <TouchableOpacity onPress={handleClearLogs} hitSlop={{ top: 6, bottom: 6 }}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {!loading && logs.length === 0 ? (
          <Text style={styles.noLogsText}>No connection events yet.</Text>
        ) : (
          logs.map(renderLog)
        )}
      </ScrollView>

      {/* MODAL: RENAME OWN DEVICE */}
      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename This Device</Text>
            <TextInput
              style={styles.textInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Counter Pixel, Owner iPhone"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.surfaceLight }]}
                onPress={() => setRenameTarget(null)}
              >
                <Text style={styles.modalBtnSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveRename}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimary}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  hintLink: { fontSize: 10, color: colors.textMuted },

  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  deviceRowOffline: { opacity: 0.6 },
  deviceRowBlocked: {
    borderColor: colors.danger + '55',
    opacity: 0.85,
  },
  blockedChip: {
    backgroundColor: colors.danger + '20',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  blockedChipText: { fontSize: 8, fontWeight: '800', color: colors.danger, letterSpacing: 0.5 },
  blockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.danger + '12',
    borderWidth: 1,
    borderColor: colors.danger + '33',
  },
  unblockBtn: {
    backgroundColor: colors.success + '14',
    borderColor: colors.success + '44',
  },
  blockBtnText: { fontSize: 10, fontWeight: '800' },
  osIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  deviceName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  deviceMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  ownChip: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  ownChipText: { fontSize: 8, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },

  emptyBox: { alignItems: 'center', padding: spacing.xl },
  emptyText: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 18 },

  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  logText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  logTime: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  noLogsText: { fontSize: 12, color: colors.textMuted, paddingVertical: spacing.md },
  clearText: { fontSize: 11, fontWeight: '700', color: colors.danger },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: spacing.md },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.sm },
  textInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  modalRow: { flexDirection: 'row', gap: 6 },
  modalBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  modalBtnPrimary: { fontSize: 13, fontWeight: '700', color: '#fff' },
  modalBtnSecondary: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
});
