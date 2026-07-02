import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, Platform, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { getServerUrl, testConnection } from '../lib/api';
import { colors, radius } from '../lib/theme';

export default function DeviceStatusHeader() {
  const [deviceName, setDeviceName] = useState('Device');
  const [isOnline, setIsOnline] = useState<boolean>(true);
  
  // Opacity value for the breathing halo animation
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // Initialize device name and details
  useEffect(() => {
    const rawName = Constants.deviceName || 
                    (Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'Device');
    // Keep it short enough for the header
    setDeviceName(rawName.length > 12 ? rawName.substring(0, 12) + '...' : rawName);
  }, []);

  // Poll connection status
  useEffect(() => {
    let active = true;
    let intervalId: any;

    const checkStatus = async () => {
      try {
        const url = await getServerUrl();
        if (!url) {
          if (active) setIsOnline(false);
          return;
        }
        const online = await testConnection(url);
        if (active) setIsOnline(online);
      } catch (err) {
        if (active) setIsOnline(false);
      }
    };

    checkStatus();
    intervalId = setInterval(checkStatus, 10000); // Check connectivity every 10 seconds

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  // Soft breathing animation loop
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const statusColor = isOnline ? colors.success : colors.danger;
  const osIcon = Platform.OS === 'ios' ? 'logo-apple' : Platform.OS === 'android' ? 'logo-android' : 'phone-portrait-outline';

  const haloOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.7],
  });

  return (
    <View style={styles.container}>
      {/* OS/Device Logo */}
      <Ionicons name={osIcon as any} size={14} color={colors.textSecondary} style={styles.osIcon} />
      
      {/* Device Name */}
      <Text style={styles.deviceNameText}>{deviceName}</Text>
      
      {/* Status Dot with Breathing Glow */}
      <View style={styles.indicatorContainer}>
        <Animated.View 
          style={[
            styles.statusHalo, 
            { 
              backgroundColor: statusColor,
              opacity: haloOpacity,
            }
          ]} 
        />
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 16,
    alignSelf: 'center',
  },
  osIcon: {
    marginRight: 6,
  },
  deviceNameText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
    marginRight: 6,
  },
  indicatorContainer: {
    width: 8,
    height: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
  },
  statusHalo: {
    width: 12,
    height: 12,
    borderRadius: 6,
    position: 'absolute',
  },
});
