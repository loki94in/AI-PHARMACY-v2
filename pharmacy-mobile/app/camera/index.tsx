import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, typography, radius, shadows } from '../../lib/theme';
import { analyzeMedicineImage } from '../../lib/api';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const cameraRef = useRef<CameraView>(null);

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: true });
      if (result) {
        setPhoto(result.uri);
        setPhotoBase64(result.base64 || null);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to capture photo');
    }
  };

  const handlePick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setPhoto(result.assets[0].uri);
      setPhotoBase64(result.assets[0].base64 || null);
    }
  };

  const handleProcess = async () => {
    if (!photo) return;
    setProcessing(true);
    setResult(null);
    try {
      // Real server-side OCR via POST /api/aicamera/analyze
      const analysis = await analyzeMedicineImage(photo, photoBase64);
      setResult(analysis);
    } catch (err: any) {
      Alert.alert('OCR Failed', err.message || 'Could not reach the PC scanner. Connect to the pharmacy WiFi and retry.');
    } finally {
      setProcessing(false);
    }
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
    const info = result?.medicineInfo || {};
    return (
      <View style={styles.container}>
        <Image source={{ uri: photo }} style={styles.previewSmall} resizeMode="contain" />
        <ScrollView style={styles.resultScroll} contentContainerStyle={styles.resultContent}>
          {processing ? (
            <View style={styles.resultCard}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[typography.bodySmall, { marginTop: spacing.xs }]}>Running OCR on PC...</Text>
            </View>
          ) : result ? (
            <>
              <View style={styles.resultCard}>
                <Text style={typography.label}>OCR RESULT</Text>
                <Text style={styles.resultLine}>
                  Name: <Text style={styles.resultValue}>{info.name || '—'}</Text>
                </Text>
                {info.mrp ? (
                  <Text style={styles.resultLine}>MRP: <Text style={styles.resultValue}>₹{info.mrp}</Text></Text>
                ) : null}
                {info.batchNumber || info.batch_no ? (
                  <Text style={styles.resultLine}>Batch: <Text style={styles.resultValue}>{info.batchNumber || info.batch_no}</Text></Text>
                ) : null}
                {info.manufacturer ? (
                  <Text style={styles.resultLine}>Mfr: <Text style={styles.resultValue}>{info.manufacturer}</Text></Text>
                ) : null}
                {info.packaging ? (
                  <Text style={styles.resultLine}>Pack: <Text style={styles.resultValue}>{info.packaging}</Text></Text>
                ) : null}
                <Text style={styles.confidenceText}>
                  Confidence: {Math.round((result.confidence || 0) * 100) / 100} · DB matches: {(result.matches || []).length}
                </Text>
              </View>
              {(result.matches || []).slice(0, 5).map((m: any, i: number) => (
                <View key={`m-${i}`} style={styles.matchRow}>
                  <Ionicons name="cube-outline" size={13} color={colors.accent} />
                  <Text style={styles.matchText} numberOfLines={1}>
                    {m.name || m.medicine_name} {m.mrp ? `· ₹${m.mrp}` : ''}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={[typography.bodySmall, { textAlign: 'center', color: colors.textMuted }]}>
              Tap "Process with AI" to scan this label on the PC
            </Text>
          )}
        </ScrollView>
        <View style={styles.previewActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              setPhoto(null);
              setResult(null);
            }}
          >
            <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
            <Text style={[typography.bodySmall, { color: colors.danger }]}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleProcess} disabled={processing}>
            <LinearGradient colors={[colors.primary, colors.primaryDark]} style={styles.processBtn}>
              {processing ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="scan-outline" size={20} color="#fff" />
                  <Text style={styles.processBtnText}>{result ? 'Re-scan' : 'Process with AI'}</Text>
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
  previewSmall: { height: '32%', backgroundColor: '#000' },
  resultScroll: { flex: 1, backgroundColor: colors.bg },
  resultContent: { padding: spacing.md },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.sm,
  },
  resultLine: { ...typography.body, marginTop: 3 },
  resultValue: { fontWeight: '700', color: colors.accent },
  confidenceText: { ...typography.caption, marginTop: spacing.sm },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  matchText: { ...typography.bodySmall, flex: 1 },
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
