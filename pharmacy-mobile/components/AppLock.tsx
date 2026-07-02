import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from '../lib/secureStore';
import { colors, spacing, typography, radius } from '../lib/theme';

interface AppLockProps {
  onUnlock: () => void;
}

export default function AppLock({ onUnlock }: AppLockProps) {
  const [pin, setPin] = useState('');
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [configuredPin, setConfiguredPin] = useState('1234'); // Default fallback

  useEffect(() => {
    (async () => {
      // Load configured PIN from storage
      const savedPin = await SecureStore.getItemAsync('app_lock_pin');
      if (savedPin) {
        setConfiguredPin(savedPin);
      }

      // Check biometrics availability
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (compatible && enrolled) {
        setHasBiometrics(true);
        triggerBiometricAuth();
      }
    })();
  }, []);

  const triggerBiometricAuth = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Pharmacy Genius OS',
        fallbackLabel: 'Use PIN code',
        disableDeviceFallback: true,
      });

      if (result.success) {
        onUnlock();
      }
    } catch (e) {
      console.warn('Biometric auth error:', e);
    }
  };

  const handleKeyPress = (num: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + num;
    setPin(newPin);

    // If fully entered, check against configured PIN
    if (newPin.length === 4) {
      if (newPin === configuredPin) {
        setTimeout(() => {
          onUnlock();
        }, 150);
      } else {
        setTimeout(() => {
          Alert.alert('Incorrect PIN', 'Please try entering your security code again.');
          setPin('');
        }, 200);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
  };

  return (
    <Modal visible transparent animationType="fade">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="lock-closed" size={48} color={colors.primary} />
          <Text style={styles.title}>System Locked</Text>
          <Text style={styles.subtitle}>Enter PIN or use biometrics to continue</Text>
        </View>

        {/* PIN Indicators */}
        <View style={styles.indicatorContainer}>
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[
                styles.dot,
                pin.length > index ? styles.activeDot : null,
              ]}
            />
          ))}
        </View>

        {/* Keypad */}
        <View style={styles.keypad}>
          <View style={styles.row}>
            {['1', '2', '3'].map((n) => (
              <TouchableOpacity key={n} style={styles.key} onPress={() => handleKeyPress(n)}>
                <Text style={styles.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row}>
            {['4', '5', '6'].map((n) => (
              <TouchableOpacity key={n} style={styles.key} onPress={() => handleKeyPress(n)}>
                <Text style={styles.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row}>
            {['7', '8', '9'].map((n) => (
              <TouchableOpacity key={n} style={styles.key} onPress={() => handleKeyPress(n)}>
                <Text style={styles.keyText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.row}>
            {/* Left action button (Biometrics if available) */}
            {hasBiometrics ? (
              <TouchableOpacity style={styles.key} onPress={triggerBiometricAuth}>
                <Ionicons name="finger-print" size={28} color={colors.primary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.key} />
            )}

            <TouchableOpacity style={styles.key} onPress={() => handleKeyPress('0')}>
              <Text style={styles.keyText}>0</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.key} onPress={handleDelete}>
              <Ionicons name="backspace-outline" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  title: {
    ...typography.h2,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  indicatorContainer: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginVertical: spacing.xl,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.divider,
    backgroundColor: 'transparent',
  },
  activeDot: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  keypad: {
    width: '80%',
    maxWidth: 300,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  key: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  keyText: {
    ...typography.h3,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
