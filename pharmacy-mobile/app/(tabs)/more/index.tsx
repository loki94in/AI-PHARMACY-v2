import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as SecureStore from '../../../lib/secureStore';
import { colors, spacing, typography, radius, shadows } from '../../../lib/theme';
import { clearServerUrl } from '../../../lib/api';

const menuItems = [
  { icon: 'camera-outline', label: 'AI Camera', desc: 'Scan medicine packaging', route: '/camera', color: '#F59E0B' },
  { icon: 'search-outline', label: 'Product Trace', desc: 'Find product across purchases & sales', route: '/product-search', color: colors.accent },
  { icon: 'cloud-upload-outline', label: 'Backup & Safety', desc: 'Create backup, restore data', route: '/backup', color: colors.info },
  { icon: 'notifications-outline', label: 'Notification History', desc: 'View all past system alerts', route: '/notifications', color: colors.primary },
];

export default function MoreScreen() {
  const router = useRouter();
  const [appLockEnabled, setAppLockEnabled] = useState(false);

  // Gmail Direct Config state
  const [gmailModalVisible, setGmailModalVisible] = useState(false);
  const [gmailUser, setGmailUser] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  useEffect(() => {
    (async () => {
      const enabled = await SecureStore.getItemAsync('app_lock_enabled');
      setAppLockEnabled(enabled === 'true');

      // Load cached Gmail configs
      setGmailUser((await SecureStore.getItemAsync('gmail_user')) || '');
      setClientId((await SecureStore.getItemAsync('google_client_id')) || '');
      setClientSecret((await SecureStore.getItemAsync('google_client_secret')) || '');
      setRefreshToken((await SecureStore.getItemAsync('gmail_oauth_refresh_token')) || '');
    })();
  }, []);

  const handleSaveGmailConfig = async () => {
    try {
      await SecureStore.setItemAsync('gmail_user', gmailUser.trim());
      await SecureStore.setItemAsync('google_client_id', clientId.trim());
      await SecureStore.setItemAsync('google_client_secret', clientSecret.trim());
      await SecureStore.setItemAsync('gmail_oauth_refresh_token', refreshToken.trim());
      
      // Reset access token so it forces refresh with the new credentials
      await SecureStore.deleteItemAsync('gmail_oauth_access_token');
      await SecureStore.deleteItemAsync('gmail_oauth_token_expiry');

      setGmailModalVisible(false);
      Alert.alert('Settings Saved', 'Direct Gmail API credentials updated. The phone will now sync emails independently.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save Gmail API settings.');
    }
  };

  const toggleAppLock = async (value: boolean) => {
    setAppLockEnabled(value);
    await SecureStore.setItemAsync('app_lock_enabled', value ? 'true' : 'false');
    if (value) {
      // Ensure there is a PIN configured, if not, set default to 1234
      const pin = await SecureStore.getItemAsync('app_lock_pin');
      if (!pin) {
        await SecureStore.setItemAsync('app_lock_pin', '1234');
        Alert.alert('App Lock Activated', 'Security lock enabled. The default unlock PIN is 1234. You can customize this PIN below.');
      } else {
        Alert.alert('App Lock Activated', 'Security lock enabled.');
      }
    } else {
      Alert.alert('App Lock Deactivated', 'Security lock disabled.');
    }
  };

  const handleChangePin = () => {
    Alert.prompt(
      'Change Security PIN',
      'Enter a new 4-digit security code:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async (pin?: string) => {
            if (pin && pin.length === 4 && /^\d+$/.test(pin)) {
              await SecureStore.setItemAsync('app_lock_pin', pin);
              Alert.alert('PIN Updated', 'Your security code has been changed successfully.');
            } else {
              Alert.alert('Invalid Code', 'Please enter a valid 4-digit number.');
            }
          },
        },
      ],
      'secure-text'
    );
  };

  const handleDisconnect = async () => {
    await clearServerUrl();
    router.replace('/');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[typography.label, { marginBottom: spacing.md }]}>TOOLS</Text>
      {menuItems.map((item, i) => (
        <TouchableOpacity key={i} style={styles.card} activeOpacity={0.7} onPress={() => router.push(item.route as any)}>
          <View style={[styles.iconWrap, { backgroundColor: item.color + '20' }]}>
            <Ionicons name={item.icon as any} size={24} color={item.color} />
          </View>
          <View style={styles.cardText}>
            <Text style={typography.body}>{item.label}</Text>
            <Text style={typography.bodySmall}>{item.desc}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      ))}

      <Text style={[typography.label, { marginTop: spacing.xl, marginBottom: spacing.md }]}>SECURITY</Text>
      
      {/* App Lock Switch Card */}
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="lock-closed-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.cardText}>
          <Text style={typography.body}>App Security Lock</Text>
          <Text style={typography.bodySmall}>Require Biometrics or PIN on launch</Text>
        </View>
        <Switch
          value={appLockEnabled}
          onValueChange={toggleAppLock}
          trackColor={{ false: colors.divider, true: colors.primary }}
          thumbColor={appLockEnabled ? '#fff' : '#f4f3f4'}
        />
      </View>

      {/* Change PIN Card */}
      {appLockEnabled && (
        <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={handleChangePin}>
          <View style={[styles.iconWrap, { backgroundColor: colors.accent + '20' }]}>
            <Ionicons name="key-outline" size={24} color={colors.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={typography.body}>Configure PIN Code</Text>
            <Text style={typography.bodySmall}>Change the 4-digit fallback PIN</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      <Text style={[typography.label, { marginTop: spacing.xl, marginBottom: spacing.md }]}>DIRECT GMAIL MODE</Text>
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => setGmailModalVisible(true)}>
        <View style={[styles.iconWrap, { backgroundColor: colors.accent + '20' }]}>
          <Ionicons name="mail-unread-outline" size={24} color={colors.accent} />
        </View>
        <View style={styles.cardText}>
          <Text style={typography.body}>Configure Direct Gmail API</Text>
          <Text style={typography.bodySmall}>Run email inbox syncing directly on the phone</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      <Text style={[typography.label, { marginTop: spacing.xl, marginBottom: spacing.md }]}>CONNECTION</Text>
      <TouchableOpacity style={[styles.card, styles.dangerCard]} activeOpacity={0.7} onPress={handleDisconnect}>
        <View style={[styles.iconWrap, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
          <Ionicons name="log-out-outline" size={24} color={colors.danger} />
        </View>
        <View style={styles.cardText}>
          <Text style={[typography.body, { color: colors.danger }]}>Disconnect Server</Text>
          <Text style={typography.bodySmall}>Change server IP address</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {/* ─── DIRECT GMAIL API CONFIGURATION MODAL ───────────────────────── */}
      <Modal
        visible={gmailModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setGmailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={typography.h2}>Direct Gmail API</Text>
                <Text style={styles.modalSubtitle}>Configure direct phone-to-Google sync settings</Text>
              </View>
              <TouchableOpacity onPress={() => setGmailModalVisible(false)}>
                <Ionicons name="close-circle-outline" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.formCard}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Gmail User Email</Text>
                  <TextInput
                    style={styles.textInput}
                    value={gmailUser}
                    onChangeText={setGmailUser}
                    placeholder="e.g. pharmacy@gmail.com"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Google Client ID</Text>
                  <TextInput
                    style={styles.textInput}
                    value={clientId}
                    onChangeText={setClientId}
                    placeholder="Enter Google Client ID"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Google Client Secret</Text>
                  <TextInput
                    style={styles.textInput}
                    value={clientSecret}
                    onChangeText={setClientSecret}
                    placeholder="Enter Google Client Secret"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>OAuth Refresh Token</Text>
                  <TextInput
                    style={styles.textInput}
                    value={refreshToken}
                    onChangeText={setRefreshToken}
                    placeholder="Enter Gmail OAuth Refresh Token"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                </View>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setGmailModalVisible(false)}
                >
                  <Text style={styles.modalBtnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnSave]}
                  onPress={handleSaveGmailConfig}
                >
                  <Text style={styles.modalBtnTextSave}>Save Settings</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.small,
  },
  dangerCard: { borderColor: 'rgba(239,68,68,0.2)' },
  iconWrap: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  cardText: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    height: '80%',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: spacing.md,
  },
  modalSubtitle: { ...typography.bodySmall, color: colors.textMuted },
  modalScroll: { flex: 1 },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  inputGroup: { gap: 4 },
  inputLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  textInput: {
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    padding: spacing.sm,
    fontSize: 14,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  modalBtnCancel: { backgroundColor: colors.surfaceLight },
  modalBtnSave: { backgroundColor: colors.accent },
  modalBtnTextCancel: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  modalBtnTextSave: { ...typography.bodySmall, color: colors.textInverse, fontWeight: '700' },
});
