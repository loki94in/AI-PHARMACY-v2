import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '../lib/theme';
import { LinearGradient } from 'expo-linear-gradient';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  gradient?: [string, string];
  style?: ViewStyle;
}

export default function StatCard({ title, value, icon, gradient, style }: StatCardProps) {
  const inner = (
    <>
      <View style={styles.iconWrap}>{icon}</View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.title}>{title}</Text>
    </>
  );

  if (gradient) {
    return (
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, style]}>
        {inner}
      </LinearGradient>
    );
  }

  return <View style={[styles.card, { backgroundColor: colors.surface }, style]}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.md,
    flex: 1,
    minHeight: 120,
    justifyContent: 'space-between',
    ...shadows.card,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  value: {
    ...typography.h1,
    color: '#fff',
  },
  title: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
});
