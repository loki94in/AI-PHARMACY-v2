import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadows } from '../lib/theme';
import { testConnection, setServerUrl, adminLogin, autoDiscoverServer } from '../lib/api';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';

interface ServerSetupProps {
  onConnected: () => void;
}

export default function ServerSetup({ onConnected }: ServerSetupProps) {
  const [viewMode, setViewMode] = useState<'options' | 'credentials'>('options');
  
  // Credentials fields
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [manualServerUrl, setManualServerUrl] = useState('');

  // Auto-discovery state
  const [discoveryStatus, setDiscoveryStatus] = useState<'searching' | 'found' | 'not_found'>('searching');
  const [discoveredUrl, setDiscoveredUrl] = useState<string | null>(null);

  // Sync manual URL when discovery resolves
  useEffect(() => {
    if (discoveredUrl) {
      setManualServerUrl(discoveredUrl);
    }
  }, [discoveredUrl]);

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  // Run auto-discovery on mount
  useEffect(() => {
    let active = true;
    const runDiscovery = async () => {
      setDiscoveryStatus('searching');
      setError('');
      try {
        const url = await autoDiscoverServer();
        if (!active) return;
        if (url) {
          setDiscoveredUrl(url);
          setDiscoveryStatus('found');
        } else {
          setDiscoveryStatus('not_found');
        }
      } catch (err) {
        if (active) setDiscoveryStatus('not_found');
      }
    };
    runDiscovery();
    return () => {
      active = false;
    };
  }, []);

  const handleRetryDiscovery = async () => {
    setDiscoveryStatus('searching');
    setError('');
    const url = await autoDiscoverServer();
    if (url) {
      setDiscoveredUrl(url);
      setDiscoveryStatus('found');
    } else {
      setDiscoveryStatus('not_found');
    }
  };

  const handleAdminLogin = async () => {
    let targetUrl = manualServerUrl.trim();
    if (!targetUrl && discoveredUrl) {
      targetUrl = discoveredUrl;
    }

    if (!targetUrl) {
      setError('Server URL is required. Ensure your PC is running and enter its IP.');
      return;
    }

    // Normalize URL
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `http://${targetUrl}`;
    }

    if (!adminUser.trim() || !adminPass.trim() || !adminKey.trim()) {
      setError('All admin credentials are required');
      return;
    }

    setTesting(true);
    setError('');

    try {
      // Test manual connection first before writing to storage
      const ok = await testConnection(targetUrl);
      if (!ok) {
        throw new Error('Cannot connect to specified Server URL. Check network or IP.');
      }

      await setServerUrl(targetUrl);
      const success = await adminLogin({
        username: adminUser.trim(),
        password: adminPass.trim(),
        uniqueKey: adminKey.trim(),
      });
      if (success) {
        onConnected();
      } else {
        setError('Failed to authenticate remote admin.');
      }
    } catch (err: any) {
      setError(err.message || 'Connection or credential validation failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    setScanned(true);
    setTesting(true);
    setError('');

    try {
      let targetUrl = '';
      
      // Try parsing the scanned code as JSON containing serverUrls
      try {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.serverUrls)) {
          // Loop over URLs and test connection
          for (const url of parsed.serverUrls) {
            const ok = await testConnection(url);
            if (ok) {
              targetUrl = url;
              break;
            }
          }
        }
      } catch (err) {
        // Scanned raw string/URL instead of JSON
        targetUrl = data.trim();
      }

      if (targetUrl) {
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = `http://${targetUrl}`;
        }
        
        const ok = await testConnection(targetUrl);
        if (ok) {
          await setServerUrl(targetUrl);
          onConnected();
          setTesting(false);
          setShowScanner(false);
          return;
        }
      }

      setError('Cannot connect to scanned server. Check connection.');
    } catch (err) {
      setError('Invalid QR code format.');
    } finally {
      setTesting(false);
      setScanned(false);
    }
  };

  if (showScanner) {
    if (!permission) {
      return (
        <View style={styles.scannerCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.scannerCenter}>
          <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
          <Text style={[typography.body, { marginTop: spacing.md, textAlign: 'center' }]}>
            Camera access is required to scan the connection QR code.
          </Text>
          <TouchableOpacity onPress={requestPermission} style={{ marginTop: spacing.lg }}>
            <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.permBtn}>
              <Text style={styles.permBtnText}>Grant Permission</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowScanner(false)} style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.textMuted, fontSize: 15 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={StyleSheet.absoluteFill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        >
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerFrame} />
            <Text style={styles.scannerHint}>Align PC QR Code within the frame</Text>
            
            <TouchableOpacity 
              onPress={() => setShowScanner(false)} 
              style={styles.scannerCloseBtn}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        {/* Branding Logo */}
        <LinearGradient
          colors={[colors.primary, colors.primaryDark]}
          style={styles.logoGradient}
        >
          <Ionicons name="sparkles" size={36} color="#fff" />
        </LinearGradient>
        <Text style={styles.title}>AI Pharmacy Genius OS</Text>
        <Text style={styles.subtitle}>Smart Connection & Management Suite</Text>

        {/* Discovery Status Banner */}
        <TouchableOpacity
          onPress={handleRetryDiscovery}
          disabled={discoveryStatus === 'searching'}
          style={[
            styles.statusBanner,
            discoveryStatus === 'found' && styles.statusBannerFound,
            discoveryStatus === 'not_found' && styles.statusBannerNotFound,
          ]}
          activeOpacity={0.8}
        >
          {discoveryStatus === 'searching' && (
            <>
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.statusText}>Searching for Pharmacy Server on Wi-Fi...</Text>
            </>
          )}
          {discoveryStatus === 'found' && (
            <>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} style={{ marginRight: 6 }} />
              <Text style={[styles.statusText, { color: colors.success }]}>
                Connected to local server
              </Text>
            </>
          )}
          {discoveryStatus === 'not_found' && (
            <>
              <Ionicons name="cloud-offline" size={16} color={colors.warning} style={{ marginRight: 6 }} />
              <Text style={[styles.statusText, { color: colors.warning }]}>
                No local server found (Tap to retry search)
              </Text>
            </>
          )}
        </TouchableOpacity>

        {viewMode === 'options' ? (
          <View style={styles.optionsContainer}>
            {/* Option 1: QR Scan Connect */}
            <TouchableOpacity
              onPress={() => setShowScanner(true)}
              activeOpacity={0.8}
              style={styles.optionButton}
            >
              <LinearGradient
                colors={[colors.primary, colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.optionGradient}
              >
                <Ionicons name="qr-code-outline" size={24} color="#fff" />
                <View style={styles.optionTextContainer}>
                  <Text style={styles.optionTitle}>Scan QR Code Login</Text>
                  <Text style={styles.optionDesc}>Quick setup using PC app QR Code</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#fff" style={{ opacity: 0.8 }} />
              </LinearGradient>
            </TouchableOpacity>

            {/* Option 2: ID & Password Login */}
            <TouchableOpacity
              onPress={() => setViewMode('credentials')}
              activeOpacity={0.8}
              style={styles.optionButton}
            >
              <LinearGradient
                colors={[colors.surfaceLight, colors.surfaceElevated]}
                style={styles.optionGradientBorder}
              >
                <Ionicons name="key-outline" size={24} color={colors.primary} />
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>ID & Password Login</Text>
                  <Text style={styles.optionDesc}>Sign in with Admin Credentials</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={{ width: '100%', marginTop: spacing.md }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header back row */}
            <View style={styles.formHeader}>
              <TouchableOpacity
                onPress={() => { setViewMode('options'); setError(''); }}
                style={styles.backBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={20} color={colors.textSecondary} />
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.formTitle}>Admin Login</Text>
            </View>

            <TextInput
              style={styles.adminInput}
              value={manualServerUrl}
              onChangeText={setManualServerUrl}
              placeholder="Server URL (e.g. http://192.168.1.15:3000)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextInput
              style={styles.adminInput}
              value={adminUser}
              onChangeText={setAdminUser}
              placeholder="Admin Username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            
            <TextInput
              style={styles.adminInput}
              value={adminPass}
              onChangeText={setAdminPass}
              placeholder="Admin Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            
            <TextInput
              style={styles.adminInput}
              value={adminKey}
              onChangeText={setAdminKey}
              placeholder="Unique Admin Key"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              onPress={handleAdminLogin}
              disabled={testing || discoveryStatus === 'searching'}
              activeOpacity={0.8}
              style={{ marginTop: spacing.sm }}
            >
              <LinearGradient
                colors={[colors.primary, colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.button, (testing || discoveryStatus === 'searching') && styles.buttonDisabled]}
              >
                {testing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="shield-checkmark-outline" size={20} color="#fff" />
                    <Text style={styles.buttonText}>Authenticate & Connect</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  inner: { alignItems: 'center', width: '100%' },
  logoGradient: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.card,
  },
  title: { ...typography.h2, textAlign: 'center', marginBottom: 4 },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    width: '100%',
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  statusBannerFound: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  statusBannerNotFound: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  optionsContainer: {
    width: '100%',
    gap: spacing.md,
  },
  optionButton: {
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadows.small,
  },
  optionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  optionGradientBorder: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  optionDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing.lg,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
  },
  backBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  formTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  adminInput: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.md,
  },
  error: { ...typography.bodySmall, color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    width: '100%',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  scannerCenter: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  permBtn: {
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
  permBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  scannerHint: {
    ...typography.bodySmall,
    color: '#fff',
    marginTop: spacing.lg,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  scannerCloseBtn: {
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
});
