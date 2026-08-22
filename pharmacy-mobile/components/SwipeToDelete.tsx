import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../lib/theme';

const DELETE_WIDTH = 88;

interface Props {
  children: React.ReactNode;
  onDelete: () => void;
}

/**
 * Swipe-left-to-delete row wrapper (core PanResponder — no native deps).
 * Horizontal-locked so vertical ScrollView scrolling is unaffected.
 */
export default function SwipeToDelete({ children, onDelete }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const open = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        translateX.setOffset(open.current ? -DELETE_WIDTH : 0);
        translateX.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        const base = open.current ? -DELETE_WIDTH : 0;
        const next = Math.min(0, Math.max(-DELETE_WIDTH - 24, base + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = open.current ? -DELETE_WIDTH : 0;
        const next = base + g.dx;
        const shouldOpen = next < -DELETE_WIDTH / 2 || g.vx < -0.6;
        open.current = shouldOpen;
        translateX.flattenOffset();
        Animated.spring(translateX, {
          toValue: shouldOpen ? -DELETE_WIDTH : 0,
          useNativeDriver: true,
          bounciness: 4,
        }).start();
      },
      onPanResponderTerminate: () => {
        translateX.flattenOffset();
        open.current = false;
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      {/* Delete action revealed behind the row */}
      <View style={styles.deleteBehind}>
        <TouchableOpacity
          style={styles.deleteBtn}
          activeOpacity={0.8}
          onPress={() => {
            open.current = false;
            Animated.timing(translateX, {
              toValue: 0,
              duration: 140,
              useNativeDriver: true,
            }).start(() => onDelete());
          }}
        >
          <Ionicons name="trash" size={20} color="#fff" />
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* The row itself */}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radius.sm + 2,
    // no margin here — wrapped rows carry their own marginBottom
  },
  deleteBehind: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: DELETE_WIDTH,
    backgroundColor: colors.danger,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    flex: 1,
    width: DELETE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  deleteText: { fontSize: 11, fontWeight: '800', color: '#fff' },
});
