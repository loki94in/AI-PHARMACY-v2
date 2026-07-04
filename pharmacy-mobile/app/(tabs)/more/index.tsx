import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as SecureStore from '../../../lib/secureStore';
import { colors, spacing, typography, radius, shadows } from '../../../lib/theme';
import { clearServerUrl, getServerUrl, disconnectGoogleAuthServer } from '../../../lib/api';
import * as WebBrowser from 'expo-web-browser';

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
  const [refreshToken, setRefreshToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    (async () => {
      const enabled = await SecureStore.getItemAsync('app_lock_enabled');
      setAppLockEnabled(enabled === 'true');

      // Load cached Gmail configs
      setGmailUser((await SecureStore.getItemAsync('gmail_user')) || '');
      setRefreshToken((await SecureStore.getItemAsync('gmail_oauth_refresh_token')) || '');
    })();
  }, []);

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    try {
      const serverUrl = await getServerUrl();
      if (!serverUrl) {
        Alert.alert('Server Offline', 'Please connect the mobile app to the pharmacy PC server first.');
        setIsConnecting(false);
        return;
      }
      
      const authUrl = `${serverUrl}/api/email/auth/google?platform=mobile`;
      const redirectUrl = 'pharmacymobile://auth/google/callback';
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      
      if (result.type === 'success' && result.url) {
        const urlStr = result.url;
        const getParam = (name: string) => {
          const match = urlStr.match(new RegExp('[?&]' + name + '=([^&#]*)'));
          return match ? decodeURIComponent(match[1]) : '';
        };
        const detectedEmail = getParam('gmail_user');
        const rToken = getParam('refresh_token');
        const aToken = getParam('access_token');
        const expiry = getParam('expiry');
        
        if (rToken) {
          await SecureStore.setItemAsync('gmail_user', detectedEmail);
          await SecureStore.setItemAsync('gmail_oauth_refresh_token', rToken);
          await SecureStore.setItemAsync('gmail_oauth_access_token', aToken);
          await SecureStore.setItemAsync('gmail_oauth_token_expiry', expiry);
          
          setGmailUser(detectedEmail);
          setRefreshToken(rToken);
          
          Alert.alert('Success', `Connected successfully as ${detectedEmail}`);
        } else {
          Alert.alert('Error', 'Authentication completed but refresh token was not received.');
        }
      }
    } catch (e: any) {
      console.error('Google auth error:', e);
      Alert.alert('Authentication Failed', 'Failed to authenticate Google account.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    Alert.alert(
      'Disconnect Account',
      'Are you sure you want to disconnect Google sync?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete locally
              await SecureStore.deleteItemAsync('gmail_user');
              await SecureStore.deleteItemAsync('gmail_oauth_refresh_token');
              await SecureStore.deleteItemAsync('gmail_oauth_access_token');
              await SecureStore.deleteItemAsync('gmail_oauth_token_expiry');
              
              setGmailUser('');
              setRefreshToken('');

              // Try to notify server
              try {
                await disconnectGoogleAuthServer();
              } catch (_) {}

              Alert.alert('Disconnected', 'Google account disconnected successfully.');
            } catch (e) {
              Alert.alert('Error', 'Failed to clear settings.');
            }
          }
        }
      ]
    );
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
                <Text style={typography.h2}>Google Account Sync</Text>
                <Text style={styles.modalSubtitle}>Sync backups and invoice emails with Google Cloud</Text>
              </View>
              <TouchableOpacity onPress={() => setGmailModalVisible(false)}>
                <Ionicons name="close-circle-outline" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.formCard}>
                {refreshToken ? (
                  <View style={{ gap: spacing.md, paddingVertical: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                      <View>
                        <Text style={[typography.body, { fontWeight: '700' }]}>Account Connected</Text>
                        <Text style={[typography.bodySmall, { color: colors.textMuted }]}>{gmailUser}</Text>
                      </View>
                    </View>
                    
                    <TouchableOpacity
                      style={[styles.modalBtn, { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' }]}
                      onPress={handleDisconnectGoogle}
                    >
                      <Text style={[styles.modalBtnTextCancel, { color: colors.danger, fontWeight: '700' }]}>Disconnect Google Account</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: spacing.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                    <Ionicons name="logo-google" size={48} color={colors.textMuted} style={{ marginBottom: spacing.xs }} />
                    <Text style={[typography.body, { textAlign: 'center', color: colors.textMuted }]}>
                      Connect your Google Account to automatically sync backups and check purchase emails directly from this device.
                    </Text>
                    
                    <TouchableOpacity
                      style={[styles.modalBtn, styles.modalBtnSave, { width: '100%', marginTop: spacing.md }]}
                      onPress={handleConnectGoogle}
                      disabled={isConnecting}
                    >
                      <Text style={styles.modalBtnTextSave}>
                        {isConnecting ? 'Connecting...' : 'Connect Google Account'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={[styles.modalActions, { marginTop: spacing.xl }]}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnCancel]}
                  onPress={() => setGmailModalVisible(false)}
                >
                  <Text style={styles.modalBtnTextCancel}>Close</Text>
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
