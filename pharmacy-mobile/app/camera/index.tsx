import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, typography, radius, shadows } from '../../lib/theme';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (result) setPhoto(result.uri);
    } catch (e) {
      Alert.alert('Error', 'Failed to capture photo');
    }
  };

  const handlePick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
    }
  };

  const handleProcess = async () => {
    if (!photo) return;
    setProcessing(true);
    // Placeholder: In production, this would upload to the backend OCR endpoint
    setTimeout(() => {
      setProcessing(false);
      Alert.alert('AI Camera', 'Image captured successfully. OCR processing would happen on the server.');
    }, 1500);
  };

  // Permission not granted yet
  if (!permission) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
        <Text style={[typography.body, { marginTop: spacing.md, textAlign: 'center' }]}>Camera access is needed to scan medicine packaging</Text>
        <TouchableOpacity onPress={requestPermission} style={{ marginTop: spacing.lg }}>
          <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.permBtn}>
            <Text style={styles.permBtnText}>Grant Permission</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  // Photo preview
  if (photo) {
    return (
      <View style={styles.container}>
        <Image source={{ uri: photo }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setPhoto(null)}>
            <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
            <Text style={[typography.bodySmall, { color: colors.danger }]}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleProcess} disabled={processing}>
            <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.processBtn}>
              {processing ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="scan-outline" size={20} color="#fff" />
                  <Text style={styles.processBtnText}>Process with AI</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera view
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <View style={styles.cameraOverlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Point camera at medicine label</Text>
        </View>
      </CameraView>
      <View style={styles.cameraControls}>
        <TouchableOpacity style={styles.controlBtn} onPress={handlePick}>
          <Ionicons name="images-outline" size={28} color={colors.textPrimary} />
          <Text style={typography.caption}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
          <View style={styles.captureInner} />
        </TouchableOpacity>
        <View style={{ width: 60 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 260, height: 160, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: 'transparent' },
  scanHint: { ...typography.bodySmall, color: '#fff', marginTop: spacing.md, textShadowColor: '#000', textShadowRadius: 4 },
  cameraControls: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    backgroundColor: colors.surface, paddingVertical: spacing.lg, paddingBottom: spacing.xl,
  },
  controlBtn: { alignItems: 'center', width: 60 },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  preview: { flex: 1, backgroundColor: '#000' },
  previewActions: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, padding: spacing.md, paddingBottom: spacing.xl,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  processBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  processBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  permBtn: { paddingVertical: 12, paddingHorizontal: spacing.xl, borderRadius: radius.md },
  permBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
