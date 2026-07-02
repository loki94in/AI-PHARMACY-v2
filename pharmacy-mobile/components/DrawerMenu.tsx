import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
  TouchableWithoutFeedback,
  DevSettings,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { colors, spacing, typography, radius } from '../lib/theme';
import { isAdminMode, adminLogout, clearServerUrl, getServerUrl, testConnection } from '../lib/api';

const { width } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.75;

interface DrawerMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DrawerMenu({ isOpen, onClose }: DrawerMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [isOnline, setIsOnline] = React.useState(true);

  React.useEffect(() => {
    if (isOpen) {
      isAdminMode().then(setIsAdmin);
      
      getServerUrl().then(async (url) => {
        if (!url) {
          setIsOnline(false);
          return;
        }
        const online = await testConnection(url);
        setIsOnline(online);
      }).catch(() => {
        setIsOnline(false);
      });
    }
  }, [isOpen]);

  const menuItems = [
    { label: 'Assistant Chat', icon: 'chatbubble-ellipses', route: '/' },
    { label: 'Inventory', icon: 'cube', route: '/(tabs)/inventory' },
    { label: 'Billing POS', icon: 'cart', route: '/(tabs)/billing' },
    { label: 'Purchases', icon: 'receipt', route: '/(tabs)/purchases' },
    { label: 'AI Camera', icon: 'camera', route: '/camera' },
    { label: 'Product Trace', icon: 'search', route: '/product-search' },
    { label: 'Backup & Safety', icon: 'cloud-upload', route: '/backup' },
  ];

  const handleNavigate = (route: string) => {
    onClose();
    setTimeout(() => {
      router.push(route as any);
    }, 150);
  };

  const handleAdminLogout = async () => {
    onClose();
    await adminLogout();
    await clearServerUrl();
    DevSettings.reload();
  };

  return (
    <Modal
      transparent
      visible={isOpen}
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Click outside to close */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Drawer content */}
        <View style={styles.drawer}>
          {/* Drawer Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Ionicons name="sparkles" size={24} color={colors.primary} />
              <View>
                <Text style={styles.logoText}>Genius OS</Text>
                {isAdmin && (
                  <View style={styles.adminBadge}>
                    <Ionicons name="shield-checkmark" size={10} color="#fff" />
                    <Text style={styles.adminBadgeText}>Remote Admin</Text>
                  </View>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Menu Items */}
          <View style={styles.menuList}>
            {menuItems.map((item, index) => {
              const isActive = pathname === item.route || 
                (item.route === '/' && pathname === '/(tabs)');
              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.menuItem, isActive && styles.activeMenuItem]}
                  onPress={() => handleNavigate(item.route)}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={isActive ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.menuLabel, isActive && styles.activeMenuLabel]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.menuItem, styles.logoutMenuItem]}
              onPress={handleAdminLogout}
            >
              <Ionicons
                name="log-out-outline"
                size={22}
                color={colors.danger}
              />
              <Text style={[styles.menuLabel, styles.logoutMenuLabel]}>
                {isAdmin ? 'Logout Admin' : 'Logout / Disconnect'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Drawer Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>AI Pharmacy OS v1.0.0</Text>
            <Text style={styles.footerSub}>
              {isOnline 
                ? (isAdmin ? 'Connected Remotely (Admin)' : 'Connected locally')
                : 'Offline Mode (Local)'}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawer: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: colors.surface,
    paddingTop: 50,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoText: {
    ...typography.h3,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginTop: 4,
    gap: 4,
    alignSelf: 'flex-start',
  },
  adminBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    textTransform: 'uppercase',
  },
  closeBtn: {
    padding: spacing.xs,
  },
  menuList: {
    flex: 1,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  activeMenuItem: {
    backgroundColor: colors.surfaceLight,
  },
  menuLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  activeMenuLabel: {
    color: colors.primary,
  },
  logoutMenuItem: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  logoutMenuLabel: {
    color: colors.danger,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerText: {
    ...typography.body,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  footerSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
