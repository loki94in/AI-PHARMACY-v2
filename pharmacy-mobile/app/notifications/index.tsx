import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { colors, spacing, typography, radius, shadows } from '../../lib/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  getSavedNotifications, 
  markAllNotificationsAsRead, 
  clearAllNotifications, 
  SavedNotification,
  isAdminMode,
  getOfflineSalesQueue,
  getOfflinePurchasesQueue,
  getOfflineStockQueue,
  getMobileAutomationTasks,
  retryMobileFallbackTask,
  updateMobileAutomationTaskStatus,
  getServerAutomationNotifications,
  retryServerNotification,
  markServerNotificationManual,
  syncOfflineSalesAndRefresh
} from '../../lib/api';

export default function NotificationsScreen() {
  const [activeSegment, setActiveSegment] = useState<'alerts' | 'tasks'>('alerts');
  const [notifications, setNotifications] = useState<SavedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();

  // Admin and sync states
  const [isAdmin, setIsAdmin] = useState(true); // Always enable automation task tab visibility
  const [pendingSales, setPendingSales] = useState(0);
  const [pendingPurchases, setPendingPurchases] = useState(0);
  const [pendingStock, setPendingStock] = useState(0);
  const [automationTasks, setAutomationTasks] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    // Load standard alerts
    const alertsData = await getSavedNotifications();
    setNotifications(alertsData);

    // Bypass to always show automation center
    setIsAdmin(true);

    const sQueue = await getOfflineSalesQueue();
    const pQueue = await getOfflinePurchasesQueue();
    const stQueue = await getOfflineStockQueue();
    setPendingSales(sQueue.length);
    setPendingPurchases(pQueue.length);
    setPendingStock(stQueue.length);

    // Load automation tasks
    const mobTasks = await getMobileAutomationTasks();
    const srvTasks = await getServerAutomationNotifications();

    // Normalize logs so they can be rendered in a unified list
    const normalizedMob = mobTasks.map(t => ({
      id: t.id,
      isMobile: true,
      type: t.type,
      recipient: t.recipient,
      subject: t.subject,
      message: t.message,
      status: t.status,
      error: t.error,
      created_at: t.created_at,
      invoice_no: t.invoice_no
    }));

    const normalizedSrv = srvTasks.map(t => ({
      id: t.id,
      isMobile: false,
      type: t.type || 'whatsapp',
      recipient: t.recipient_phone,
      subject: undefined,
      message: t.message,
      status: t.status,
      error: t.error_message,
      created_at: t.created_at,
      invoice_no: t.invoice_id ? `INV-${t.invoice_id}` : undefined
    }));

    const combined = [...normalizedMob, ...normalizedSrv].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setAutomationTasks(combined);
    
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Update header right buttons
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={handleMarkAllRead} style={styles.headerBtn} activeOpacity={0.7}>
            <Ionicons name="mail-open-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClearAll} style={[styles.headerBtn, { marginLeft: spacing.md }]} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [notifications, navigation]);

  const handleMarkAllRead = async () => {
    if (notifications.length === 0) return;
    await markAllNotificationsAsRead();
    loadData();
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    Alert.alert(
      'Clear Notifications',
      'Are you sure you want to delete all alert history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await clearAllNotifications();
            loadData();
          },
        },
      ]
    );
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const res = await syncOfflineSalesAndRefresh();
      Alert.alert('Sync Complete', `Synced ${res.syncedCount} item(s) successfully.`);
      await loadData();
    } catch (err: any) {
      Alert.alert('Sync Failed', err.message || 'Error occurred during sync');
    } finally {
      setSyncing(false);
    }
  };

  const handleRetryTask = async (item: any) => {
    setRetryingId(item.id);
    try {
      let ok = false;
      if (item.isMobile) {
        ok = await retryMobileFallbackTask(item.id);
      } else {
        ok = await retryServerNotification(item.id);
      }
      if (ok) {
        Alert.alert('Success', 'Task retried and sent successfully!');
      } else {
        Alert.alert('Failed', 'Retry failed. Check network or configuration.');
      }
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to retry task');
    } finally {
      setRetryingId(null);
    }
  };

  const handleMarkManual = async (item: any) => {
    setRetryingId(item.id);
    try {
      let ok = false;
      if (item.isMobile) {
        await updateMobileAutomationTaskStatus(item.id, 'sent_manually');
        ok = true;
      } else {
        ok = await markServerNotificationManual(item.id);
      }
      if (ok) {
        Alert.alert('Updated', 'Task marked as sent manually.');
      } else {
        Alert.alert('Failed', 'Could not update task status.');
      }
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update task status');
    } finally {
      setRetryingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  if (loading && notifications.length === 0 && automationTasks.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isAdmin && (
        <View style={styles.segmentContainer}>
          <TouchableOpacity
            style={[styles.segmentButton, activeSegment === 'alerts' && styles.segmentButtonActive]}
            onPress={() => setActiveSegment('alerts')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, activeSegment === 'alerts' && styles.segmentTextActive]}>System Alerts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentButton, activeSegment === 'tasks' && styles.segmentButtonActive]}
            onPress={() => setActiveSegment('tasks')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, activeSegment === 'tasks' && styles.segmentTextActive]}>Automation Task Center</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeSegment === 'alerts' ? (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isWarning = 
              item.title.toLowerCase().includes('warning') || 
              item.title.toLowerCase().includes('fail') || 
              item.title.toLowerCase().includes('error');
            const isSuccess = 
              item.title.toLowerCase().includes('success') || 
              item.title.toLowerCase().includes('complete') || 
              item.title.toLowerCase().includes('saved') || 
              item.title.toLowerCase().includes('synced');

            return (
              <View style={[styles.card, !item.read && styles.unreadCard]}>
                {!item.read && (
                  <View style={[styles.unreadDot, { backgroundColor: isWarning ? colors.danger : isSuccess ? colors.success : colors.primary }]} />
                )}

                <View style={styles.cardHeader}>
                  <Ionicons
                    name={isWarning ? 'warning' : isSuccess ? 'checkmark-circle' : 'notifications'}
                    size={16}
                    color={isWarning ? colors.danger : isSuccess ? colors.success : colors.primary}
                    style={styles.cardIcon}
                  />
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.dateText}>{formatDate(item.timestamp)}</Text>
                </View>

                <Text style={styles.bodyText}>{item.body}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="notifications-off-outline" size={60} color={colors.textMuted} />
              <Text style={[typography.h3, { marginTop: spacing.md, color: colors.textSecondary }]}>
                No Alerts Yet
              </Text>
              <Text style={[typography.bodySmall, { textAlign: 'center', marginTop: spacing.sm, color: colors.textMuted }]}>
                System alerts, billing confirmations, and stock updates will be logged here.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={automationTasks}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.syncCard}>
              <Text style={styles.syncCardTitle}>Offline Queues Status</Text>
              <View style={styles.syncRow}>
                <View style={styles.syncCol}>
                  <Text style={styles.syncValue}>{pendingSales}</Text>
                  <Text style={styles.syncLabel}>Sales</Text>
                </View>
                <View style={styles.syncCol}>
                  <Text style={styles.syncValue}>{pendingPurchases}</Text>
                  <Text style={styles.syncLabel}>Purchases</Text>
                </View>
                <View style={styles.syncCol}>
                  <Text style={styles.syncValue}>{pendingStock}</Text>
                  <Text style={styles.syncLabel}>Stock Updates</Text>
                </View>
              </View>
              
              <TouchableOpacity
                onPress={handleTriggerSync}
                disabled={syncing || (pendingSales === 0 && pendingPurchases === 0 && pendingStock === 0)}
                activeOpacity={0.8}
                style={{ marginTop: spacing.md }}
              >
                <LinearGradient
                  colors={[colors.primary, colors.primaryDark]}
                  style={[styles.syncBtn, (pendingSales === 0 && pendingPurchases === 0 && pendingStock === 0) && styles.syncBtnDisabled]}
                >
                  {syncing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sync-outline" size={18} color="#fff" />
                      <Text style={styles.syncBtnText}>Sync Now</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const isFailed = item.status === 'failed';
            const statusColor = 
              item.status === 'sent' ? colors.success :
              item.status === 'pending' ? colors.warning :
              item.status === 'failed' ? colors.danger :
              colors.info;
            
            return (
              <View style={[styles.taskCard, isFailed && styles.failedTaskCard]}>
                <View style={styles.taskHeader}>
                  <Ionicons
                    name={item.type === 'email' ? 'mail-outline' : 'logo-whatsapp'}
                    size={20}
                    color={item.type === 'email' ? colors.primary : '#25D366'}
                  />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={styles.taskTitle}>
                      {item.isMobile ? 'Direct Mobile' : 'Server Agent'} {item.type === 'email' ? 'Email' : 'WhatsApp'}
                    </Text>
                    <Text style={styles.taskSubtitle}>To: {item.recipient}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                      {item.status.replace('_', ' ')}
                    </Text>
                  </View>
                </View>
                
                {item.invoice_no ? (
                  <Text style={styles.invoiceText}>Invoice: {item.invoice_no}</Text>
                ) : null}
                
                <Text style={styles.taskMsg} numberOfLines={3}>{item.message}</Text>
                
                {isFailed && item.error ? (
                  <Text style={styles.errorText}>Error: {item.error}</Text>
                ) : null}

                {(item.status === 'failed' || item.status === 'pending') && (
                  <View style={styles.taskActions}>
                    <TouchableOpacity
                      onPress={() => handleMarkManual(item)}
                      style={[styles.taskBtn, styles.taskBtnSecondary]}
                      disabled={retryingId === item.id}
                    >
                      <Text style={styles.taskBtnSecondaryText}>Mark Sent</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      onPress={() => handleRetryTask(item)}
                      style={[styles.taskBtn, styles.taskBtnPrimary]}
                      disabled={retryingId === item.id}
                    >
                      {retryingId === item.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="refresh-outline" size={14} color="#fff" />
                          <Text style={styles.taskBtnPrimaryText}>Retry</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="checkbox-outline" size={60} color={colors.textMuted} />
              <Text style={[typography.h3, { marginTop: spacing.md, color: colors.textSecondary }]}>
                All Automation Clear
              </Text>
              <Text style={[typography.bodySmall, { textAlign: 'center', marginTop: spacing.sm, color: colors.textMuted }]}>
                No pending fallback communications or automated messages at the moment.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  headerBtn: {
    padding: 4,
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceLight,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.md,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  segmentButtonActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.small,
  },
  unreadCard: {
    borderColor: 'rgba(108, 99, 255, 0.35)',
    backgroundColor: 'rgba(108, 99, 255, 0.02)',
  },
  unreadDot: {
    position: 'absolute',
    left: 8,
    top: 18,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    paddingLeft: 4,
  },
  cardIcon: {
    marginRight: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  dateText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  bodyText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    paddingLeft: 22,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
    paddingHorizontal: spacing.xl,
  },
  syncCard: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.small,
  },
  syncCardTitle: {
    ...typography.h3,
    marginBottom: spacing.md,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.sm,
  },
  syncCol: {
    alignItems: 'center',
  },
  syncValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primaryLight,
  },
  syncLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  syncBtnDisabled: {
    opacity: 0.4,
  },
  syncBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  taskCard: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.small,
  },
  failedTaskCard: {
    borderColor: colors.danger,
    borderWidth: 1.2,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  taskSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  invoiceText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primaryLight,
    marginTop: spacing.sm,
  },
  taskMsg: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    marginVertical: spacing.sm,
    backgroundColor: colors.surfaceLight,
    padding: 8,
    borderRadius: radius.sm,
  },
  errorText: {
    fontSize: 11,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  taskActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  taskBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  taskBtnPrimary: {
    backgroundColor: colors.primary,
  },
  taskBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  taskBtnPrimaryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  taskBtnSecondaryText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
});
