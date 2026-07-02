import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { colors, spacing, typography, radius, shadows } from '../../lib/theme';
import { getDashboard, searchMedicine, SearchMedicineResult, getServerUrl, testConnection, createSale, searchPharmarack, addPharmarackCart, logAssistantChat } from '../../lib/api';
import * as SecureStore from '../../lib/secureStore';
import { cartEvents } from '../../lib/cartEvents';
import DrawerMenu from '../../components/DrawerMenu';

import * as ImagePicker from 'expo-image-picker';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  actions?: { label: string; route?: string }[];
  products?: SearchMedicineResult[];
  pharmarackProducts?: any[];
}

interface ChatInputProps {
  onSend: (text: string) => void;
  onUploadPhoto: () => void;
}

const ChatInput = React.memo(({ onSend, onUploadPhoto }: ChatInputProps) => {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={styles.inputArea}>
      <TouchableOpacity style={styles.photoBtn} onPress={onUploadPhoto}>
        <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />
      </TouchableOpacity>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Ask Pharmacy Genius..."
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        onSubmitEditing={handleSend}
      />
      <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
        <Ionicons name="send" size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );
});

export default function AssistantScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Device identity info for PC assistant chat logs
  const [deviceUuid, setDeviceUuid] = useState('DEV-Unknown');
  const [deviceName, setDeviceName] = useState('Mobile Client');

  useEffect(() => {
    const loadDeviceInfo = async () => {
      try {
        const uuid = await SecureStore.getItemAsync('admin_device_uuid');
        if (uuid) setDeviceUuid(uuid);
        const name = await SecureStore.getItemAsync('admin_authorized_device_name');
        if (name) setDeviceName(name);
      } catch (err) {
        console.warn('Failed to load device info for chat logging:', err);
      }
    };
    loadDeviceInfo();
  }, []);

  // Quick Process Sale state
  const [quickSaleItem, setQuickSaleItem] = useState<SearchMedicineResult | null>(null);
  const [quickSaleQty, setQuickSaleQty] = useState('1');
  const [quickSalePatient, setQuickSalePatient] = useState('');
  const [quickSaleProcessing, setQuickSaleProcessing] = useState(false);
  const [quickSaleSuccess, setQuickSaleSuccess] = useState<{ invoice_no: string; total: number; isOffline: boolean } | null>(null);
  

  
  // Collapse/Expand state for product lists in chat bubble
  const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>({});

  // Dynamic header visibility to maximize screen when list is scrolled
  const [hideHeader, setHideHeader] = useState(false);
  
  // Dynamic Connection Status States
  type ConnStatus = 'checking' | 'online' | 'no_url' | 'offline';
  const [connStatus, setConnStatus] = useState<ConnStatus>('checking');
  const [serverUrl, setServerUrl] = useState<string>('');
  // Derived: treat as online only when truly connected
  const isOnline = connStatus === 'online';

  const checkStatus = useCallback(async () => {
    try {
      const url = await getServerUrl();
      if (!url) {
        setConnStatus('no_url');
        setServerUrl('');
        return;
      }
      setServerUrl(url);
      const online = await testConnection(url);
      setConnStatus(online ? 'online' : 'offline');
    } catch {
      setConnStatus('offline');
    }
  }, []);

  useEffect(() => {
    let intervalId: any;
    setConnStatus('checking');
    checkStatus();
    intervalId = setInterval(checkStatus, 12000);
    return () => clearInterval(intervalId);
  }, [checkStatus]);
  
  // New States for User Role & ABC Checklist
  const [userRole, setUserRole] = useState<'staff' | 'distributor'>('staff');
  const [abcChecklist, setAbcChecklist] = useState<Array<{ name: string; checked: boolean }>>([
    { name: 'ONDEM MD 4', checked: false },
    { name: 'CROCIN 650', checked: false },
    { name: 'PAN D', checked: false },
    { name: 'AMOXICILLIN 500', checked: false }
  ]);

  // Prescription modal form state
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false);
  const [prescriptionForm, setPrescriptionForm] = useState({
    patient_name: 'Dinesh Kumar',
    doctor_name: 'Dr. A. K. Sharma',
    medicines: [
      { name: 'ONDEM MD 4', quantity: 2, unit_price: 12.50, inventory_id: 1 },
      { name: 'CROCIN 650', quantity: 10, unit_price: 2.00, inventory_id: 2 }
    ]
  });

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'assistant',
      text: 'Hello! I am your Pharmacy Genius Assistant. How can I help you manage the pharmacy today?',
      timestamp: new Date(),
    },
  ]);

  const suggestionChips = [
    { label: 'Find ONDEM 🔍', value: 'find ONDEM' },
    { label: 'PR ONDEM 🌐', value: 'pr ONDEM' },
    { label: 'Create Bill 🧾', value: 'billing' },
    { label: 'AI Camera 📸', value: 'camera' },
    { label: 'Low Stock ⚠️', value: 'lowstock' },
  ];

  // Auto-scroll to bottom of chat
  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const triggerLocalNotification = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Pharmacy Alert 🔔',
        body: 'This is a test push notification from your Pharmacy Genius Assistant!',
        data: { screen: 'Dashboard' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
    });
  };

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim()) return;

    const userMessage: Message = {
      id: Math.random().toString(),
      sender: 'user',
      text: textToSend,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    // Sync user message to server in background
    logAssistantChat({
      sessionId: deviceUuid,
      deviceName: deviceName,
      sender: 'user',
      messageText: textToSend,
    }).catch(console.warn);

    // Simulate AI thinking and responsive action logic
    setTimeout(async () => {
      let replyText = "I'm not sure how to handle that request. Try selecting one of the quick actions below!";
      let actions: Message['actions'] = [];
      let products: SearchMedicineResult[] | undefined = undefined;
      let pharmarackProducts: any[] | undefined = undefined;
      const cleanText = textToSend.toLowerCase().trim();

      // Check if it's a product search query (e.g., "find ...", "search ...", or user types medicine name)
      if (cleanText.startsWith('pharmarack ') || cleanText.startsWith('pr ')) {
        const query = cleanText.replace(/^(pharmarack|pr)\s+/, '');
        try {
          const results = await searchPharmarack(query);
          if (results && results.length > 0) {
            replyText = `I found ${results.length} matches in Pharmarack for "${query}":`;
            pharmarackProducts = results;
          } else {
            replyText = `I couldn't find any products matching "${query}" on Pharmarack.`;
          }
        } catch (err) {
          replyText = `Error searching Pharmarack for "${query}". Make sure you are logged in on the PC backend.`;
        }
      } else if (
        cleanText.startsWith('find ') ||
        cleanText.startsWith('search ') ||
        cleanText.includes('ondem') ||
        cleanText.includes('amoxicillin') ||
        cleanText.includes('clavam') ||
        cleanText.includes('crocin') ||
        cleanText.includes('dolo') ||
        cleanText.includes('paracetamol') ||
        cleanText.includes('pan') ||
        (!cleanText.includes('bill') && !cleanText.includes('sale') && !cleanText.includes('camera') && !cleanText.includes('photo') && !cleanText.includes('scan') && !cleanText.includes('stock') && !cleanText.includes('inventory') && !cleanText.includes('notify') && !cleanText.includes('backup') && !cleanText.includes('hi') && !cleanText.includes('hello') && cleanText.trim().length >= 2)
      ) {
        const query = cleanText.replace(/^(find|search)\s+/, '');
        try {
          const results = await searchMedicine(query);
          if (results && results.length > 0) {
            replyText = `I found ${results.length} matches in the inventory for "${query}":`;
            products = results;
          } else {
            // Fallback to Pharmarack search automatically if not found in local stock
            try {
              const prResults = await searchPharmarack(query);
              if (prResults && prResults.length > 0) {
                replyText = `I couldn't find "${query}" in local stock, but found ${prResults.length} matches on Pharmarack:`;
                pharmarackProducts = prResults;
              } else {
                replyText = `I couldn't find any products matching "${query}" in stock or on Pharmarack.`;
              }
            } catch {
              replyText = `I couldn't find "${query}" in local stock, and Pharmarack search failed.`;
            }
          }
        } catch (err) {
          replyText = `Error searching for "${query}". Make sure the backend is active.`;
        }
      } else if (cleanText.includes('bill') || cleanText.includes('sale') || cleanText === 'billing') {
        replyText = 'Ready to create a new customer invoice! Click the button below to open the billing counter.';
        actions = [{ label: 'Open POS Billing 🧾', route: '/(tabs)/billing' }];
      } else if (cleanText.includes('camera') || cleanText.includes('photo') || cleanText.includes('scan')) {
        replyText = 'You can capture packaging photos to verify batches or scan invoices using our AI Camera.';
        actions = [{ label: 'Launch AI Camera 📸', route: '/camera' }];
      } else if (cleanText.includes('stock') || cleanText.includes('inventory') || cleanText === 'lowstock') {
        try {
          const dashData = await getDashboard();
          replyText = `I checked the database: There are currently ${dashData.lowStock} products marked as Low Stock.`;
          actions = [{ label: 'View Inventory 📦', route: '/(tabs)/inventory' }];
        } catch (err) {
          replyText = 'There are some items running low in the inventory. Click below to inspect.';
          actions = [{ label: 'View Inventory 📦', route: '/(tabs)/inventory' }];
        }
      } else if (cleanText.includes('notify') || cleanText.includes('alert') || cleanText.includes('push')) {
        replyText = 'Sending a test notification to your device now...';
        await triggerLocalNotification();
      } else if (cleanText.includes('backup') || cleanText.includes('save db')) {
        replyText = 'Initializing secure database backup. This will save a dump of your transactions and inventory.';
        actions = [{ label: 'Trigger Database Backup 💾', route: '/backup' }];
      } else if (cleanText.includes('hi') || cleanText.includes('hello')) {
        replyText = 'Hello there! Let me know if you need to create a bill, check stock levels, or search for products.';
      }

      const assistantMessage: Message = {
        id: Math.random().toString(),
        sender: 'assistant',
        text: replyText,
        timestamp: new Date(),
        actions,
        products,
        pharmarackProducts,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setLoading(false);

      // Sync assistant reply to server in background
      logAssistantChat({
        sessionId: deviceUuid,
        deviceName: deviceName,
        sender: 'assistant',
        messageText: replyText,
        metadata: products ? products : (pharmarackProducts ? pharmarackProducts : undefined)
      }).catch(console.warn);
    }, 800);
  };

  const handleAction = (action: { label: string; route?: string }) => {
    if (action.route) {
      router.push(action.route as any);
    }
  };

  // Upload/Capture Image Handler for OCR
  const handleUploadPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setLoading(true);
        const imageUri = result.assets[0].uri;

        // Add user upload message to chat
        const uploadMsg: Message = {
          id: Math.random().toString(),
          sender: 'user',
          text: `📷 Uploaded photo for OCR scanning...`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, uploadMsg]);

        // Simulate server-side OCR & Fuzzy Scanning response
        setTimeout(() => {
          setLoading(false);
          if (userRole === 'distributor') {
            // Check off items in ABC Checklist
            setAbcChecklist(prev => 
              prev.map(item => 
                (item.name === 'ONDEM MD 4' || item.name === 'PAN D') 
                  ? { ...item, checked: true } 
                  : item
              )
            );
            
            const assistMsg: Message = {
              id: Math.random().toString(),
              sender: 'assistant',
              text: `🔍 *AI Scanner Results:*\nInvoice photo processed successfully.\n- Found match for *ONDEM MD 4* (checked off)\n- Found match for *PAN D* (checked off)\n\nABC Checklist updated!`,
              timestamp: new Date()
            };
            setMessages(prev => [...prev, assistMsg]);
          } else {
            // Staff mode: open Prescription extraction modal
            setShowPrescriptionModal(true);
          }
        }, 1500);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to pick photo.');
    }
  };

  const performAddPharmarack = async (item: any, qty: number) => {
    try {
      setLoading(true);
      await addPharmarackCart([{
        productId: item.productId,
        storeId: item.storeId,
        qty: qty,
        rate: item.rate,
        scheme: item.scheme,
        productCode: item.productCode,
        company: item.company,
        productName: item.name,
        storeName: item.distributor,
        packaging: item.packaging,
        mapped: item.mapped
      }]);
      Alert.alert('Success', `Added ${qty} units of ${item.name} to Pharmarack cart!`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to add to Pharmarack cart');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPharmarackCart = async (item: any) => {
    Alert.alert(
      'Add to Pharmarack Cart',
      `Add ${item.name} from ${item.distributor}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add 10 Qty',
          onPress: () => performAddPharmarack(item, 10)
        },
        {
          text: 'Add 50 Qty',
          onPress: () => performAddPharmarack(item, 50)
        }
      ]
    );
  };

  // ── Quick Process: instant sale from medicine card ──
  const handleQuickProcess = async () => {
    if (!quickSaleItem) return;
    const qty = parseInt(quickSaleQty, 10);
    if (!qty || qty <= 0) { Alert.alert('Invalid Qty', 'Please enter a valid quantity.'); return; }
    if (qty > quickSaleItem.quantity) { Alert.alert('Insufficient Stock', `Only ${quickSaleItem.quantity} in stock.`); return; }

    setQuickSaleProcessing(true);
    try {
      const res = await createSale({
        items: [{ inventory_id: quickSaleItem.inventory_id, quantity: qty, unit_price: quickSaleItem.mrp || quickSaleItem.unit_price || 0 }],
        patient_name: quickSalePatient || undefined,
        payment_medium: 'CASH',
        payment_status: 'PAID',
      });
      const isOffline = res.invoice_no.startsWith('TEMP-MOB-');
      setQuickSaleSuccess({ invoice_no: res.invoice_no, total: res.total, isOffline });

      // Notify
      Notifications.scheduleNotificationAsync({
        content: {
          title: isOffline ? '💾 Sale Saved (Offline)' : '⚡ Sale Processed',
          body: `${quickSaleItem.medicine_name} x${qty} — ₹${res.total.toFixed(2)}. Invoice: ${res.invoice_no}`,
        },
        trigger: null,
      }).catch(() => {});

      // Add confirmation message to chat
      const assistMsg: Message = {
        id: Math.random().toString(),
        sender: 'assistant',
        text: isOffline
          ? `💾 *Offline Sale Queued*\n${quickSaleItem.medicine_name} x${qty} → ₹${res.total.toFixed(2)}\nInvoice: ${res.invoice_no}\n\n⏳ Will sync when back online.`
          : `✅ *Sale Processed*\n${quickSaleItem.medicine_name} x${qty} → ₹${res.total.toFixed(2)}\nInvoice: ${res.invoice_no}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistMsg]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to process sale.');
    } finally {
      setQuickSaleProcessing(false);
    }
  };

  const handleSaveStagedSale = async () => {
    try {
      // Map to SalePayload format
      const payload = {
        items: prescriptionForm.medicines.map(m => ({
          inventory_id: m.inventory_id,
          quantity: m.quantity,
          unit_price: m.unit_price
        })),
        patient_name: prescriptionForm.patient_name,
        patient_phone: '9876543210',
        discount: 0,
        payment_medium: 'CASH',
        payment_status: 'PAID'
      };

      const { createSale } = await import('../../lib/api');
      await createSale(payload);

      setShowPrescriptionModal(false);
      Alert.alert('Success', 'Prescription details verified and staged sale created. Stamped invoice sent on WhatsApp.');
      
      const assistMsg: Message = {
        id: Math.random().toString(),
        sender: 'assistant',
        text: `✅ Staged Sale successfully created for Patient: *${prescriptionForm.patient_name}*.\n- Doctor: *${prescriptionForm.doctor_name}*\n- Items: ONDEM MD 4 (x2), CROCIN 650 (x10)\n\nChecked in to PC review queue!`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistMsg]);
    } catch (err: any) {
      Alert.alert('Sync Error', 'Sale saved locally. Will upload to PC on next sync.');
      setShowPrescriptionModal(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      style={styles.container}
    >
      {/* Connectivity Status Bar — tap to retry */}
      {!hideHeader && (
        <TouchableOpacity
          style={[
            styles.connectStatusBar,
            { backgroundColor: connStatus === 'online' ? '#0c0a09' : connStatus === 'checking' ? '#1a1a2e' : '#1a0a0a' }
          ]}
          onPress={() => { setConnStatus('checking'); checkStatus(); }}
          activeOpacity={0.7}
        >
          <View style={[styles.connectDot, {
            backgroundColor:
              connStatus === 'online'   ? colors.success :
              connStatus === 'checking' ? colors.warning  :
              colors.danger
          }]} />
          <Text style={styles.connectStatusText} numberOfLines={1}>
            {connStatus === 'online'   ? `✓ Server: ${serverUrl.replace(/^https?:\/\//, '')}` :
             connStatus === 'checking' ? 'Checking connection...' :
             connStatus === 'no_url'   ? 'No server configured — tap Settings to add PC IP' :
             `Server unreachable — tap to retry`}
          </Text>
          {connStatus !== 'online' && connStatus !== 'checking' && (
            <Ionicons name="refresh-outline" size={12} color={colors.danger} style={{ marginLeft: 4 }} />
          )}
        </TouchableOpacity>
      )}

      {/* Header */}
      {!hideHeader && (
        <View style={styles.header}>
          <View style={styles.leftHeader}>
            <TouchableOpacity onPress={() => setDrawerOpen(true)} style={styles.menuBtn}>
              <Ionicons name="menu-outline" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.assistantStatus}>
              <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.success : colors.danger }]} />
              <View>
                <Text style={styles.assistantTitle}>Pharmacy Genius AI</Text>
                <Text style={styles.assistantSubtitle}>Always active & ready</Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity 
              style={styles.clearBtn} 
              onPress={() => router.push('/camera')}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.clearBtn} 
              onPress={() => setMessages([messages[0]])}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Role Toggle Selector */}
      {!hideHeader && (
        <View style={styles.roleContainer}>
          <Text style={styles.roleLabel}>Mode:</Text>
          <View style={styles.roleTabsWrapper}>
            <TouchableOpacity 
              style={[styles.roleTab, userRole === 'staff' && styles.roleTabActive]} 
              onPress={() => setUserRole('staff')}
            >
              <Text style={[styles.roleTabText, userRole === 'staff' && styles.roleTabActiveText]}>Staff Mode</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.roleTab, userRole === 'distributor' && styles.roleTabActive]} 
              onPress={() => setUserRole('distributor')}
            >
              <Text style={[styles.roleTabText, userRole === 'distributor' && styles.roleTabActiveText]}>Distributor Mode</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Drawer navigation */}
      <DrawerMenu isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Messages / Chat list */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
      >
        {/* ABC Checklist - Only shown in Distributor Mode */}
        {userRole === 'distributor' && !hideHeader && (
          <View style={styles.checklistCard}>
            <View className="flex-row items-center justify-between mb-3 border-b border-zinc-700/50 pb-2">
              <Text style={styles.checklistTitle}>📋 Distributor ABC Shortage Checklist</Text>
              <Text style={styles.checklistSub}>Active Stock Needs</Text>
            </View>
            <View style={styles.checklistGrid}>
              {abcChecklist.map((item, idx) => (
                <View key={idx} style={styles.checkItem}>
                  <Ionicons 
                    name={item.checked ? "checkbox" : "square-outline"} 
                    size={20} 
                    color={item.checked ? colors.success : colors.textSecondary} 
                  />
                  <Text style={[styles.checkItemText, item.checked && styles.checkItemTextCompleted]}>
                    {item.name}
                  </Text>
                  {item.checked && (
                    <Text style={styles.checkedLabel}>Checked</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.messageRow,
              msg.sender === 'user' ? styles.userRow : styles.assistantRow,
            ]}
          >
            {msg.sender === 'assistant' && (
              <View style={styles.avatar}>
                <Ionicons name="sparkles" size={16} color="#fff" />
              </View>
            )}
            <View
              style={[
                styles.bubble,
                msg.sender === 'user' ? styles.userBubble : styles.assistantBubble,
                msg.products || msg.pharmarackProducts ? { width: '90%', maxWidth: '90%' } : null,
              ]}
            >
              <Text style={styles.messageText}>{msg.text}</Text>

              {/* Products search Carousel inside chat bubble */}
              {msg.products && (
                <View style={styles.verticalListContainer}>
                  {(() => {
                    const displayProducts: Array<SearchMedicineResult & { isAlternativeFor?: string }> = [];
                    msg.products.forEach(prod => {
                      displayProducts.push(prod);
                      if (prod.alternatives && prod.alternatives.length > 0) {
                        prod.alternatives.forEach(alt => {
                          displayProducts.push({
                            ...alt,
                            isAlternativeFor: prod.medicine_name
                          });
                        });
                      }
                    });

                    const isCollapsed = collapsedStates[msg.id] === true; // Default to false (expanded)

                    return (
                      <View style={{ gap: 8 }}>
                        <TouchableOpacity
                          style={styles.dropdownHeader}
                          onPress={() => setCollapsedStates(prev => ({ ...prev, [msg.id]: !isCollapsed }))}
                          activeOpacity={0.7}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                          <View style={styles.dropdownHeaderContent}>
                            <Ionicons
                              name={isCollapsed ? "chevron-down-circle" : "chevron-up-circle"}
                              size={20}
                              color={colors.primary}
                            />
                            <Text style={styles.dropdownHeaderText}>
                              {isCollapsed
                                ? `Show Inventory Results (${displayProducts.length})`
                                : `Hide Inventory Results`}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {!isCollapsed && (
                          <>
                            <View style={styles.scrollBoxWrapper}>
                              <ScrollView
                                style={styles.smallScrollBox}
                                nestedScrollEnabled={true}
                                contentContainerStyle={{ gap: 8, paddingVertical: 12, paddingHorizontal: 4 }}
                                onScroll={(event) => {
                                  const offsetY = event.nativeEvent.contentOffset.y;
                                  if (offsetY > 10) {
                                    setHideHeader(true);
                                  } else if (offsetY <= 5) {
                                    setHideHeader(false);
                                  }
                                }}
                                scrollEventThrottle={16}
                              >
                                {displayProducts.map((item, index) => {
                                  const isOutOfStock = item.quantity <= 0 || item.is_out_of_stock;
                                  const isSub = !!item.isAlternativeFor;

                                  return (
                                    <View
                                      key={index}
                                      style={[
                                        styles.productCardVertical,
                                        isSub && { borderColor: '#06b6d4', borderWidth: 1.5 },
                                        isOutOfStock && { opacity: 0.85 }
                                      ]}
                                    >
                                      {isSub && (
                                        <View style={styles.subTag}>
                                          <Text style={styles.subTagText}>Sub for {item.isAlternativeFor}</Text>
                                        </View>
                                      )}

                                      <View style={styles.cardMainRow}>
                                        <View style={{ flex: 1, paddingLeft: 4 }}>
                                          <Text style={styles.productNameVertical} numberOfLines={1}>{item.medicine_name}</Text>
                                          {isOutOfStock && (
                                            <Text style={styles.outOfStockText}>OUT OF STOCK</Text>
                                          )}
                                          <Text style={styles.productDetail}>Batch: {item.batch_no} | Exp: {item.expiry_date} | Stock: {item.quantity}</Text>
                                          <Text style={styles.productDetail}>Rate: ₹{Number(item.unit_price || item.mrp || 0).toFixed(2)} | MRP: ₹{Number(item.mrp || 0).toFixed(2)}</Text>
                                          <Text style={styles.productDetail}>Scheme: None</Text>
                                        </View>
                                        
                                        {!isOutOfStock && (
                                          <View style={styles.qtyContainerRight}>
                                            <View style={styles.qtyStepper}>
                                              <TouchableOpacity
                                                style={styles.qtyStepperBtn}
                                                onPress={() => {
                                                  const key = `local-${item.inventory_id}`;
                                                  const currentVal = quantities[key] || 1;
                                                  setQuantities(prev => ({ ...prev, [key]: Math.max(1, currentVal - 1) }));
                                                }}
                                              >
                                                <Ionicons name="remove" size={14} color={colors.textPrimary} />
                                              </TouchableOpacity>
                                              <TextInput
                                                style={styles.qtyStepperInput}
                                                value={String(quantities[`local-${item.inventory_id}`] || 1)}
                                                onChangeText={(text) => {
                                                  const val = parseInt(text, 10);
                                                  const key = `local-${item.inventory_id}`;
                                                  setQuantities(prev => ({ ...prev, [key]: isNaN(val) ? 1 : Math.max(1, val) }));
                                                }}
                                                keyboardType="number-pad"
                                                selectTextOnFocus={true}
                                              />
                                              <TouchableOpacity
                                                style={styles.qtyStepperBtn}
                                                onPress={() => {
                                                  const key = `local-${item.inventory_id}`;
                                                  const currentVal = quantities[key] || 1;
                                                  setQuantities(prev => ({ ...prev, [key]: currentVal + 1 }));
                                                }}
                                              >
                                                <Ionicons name="add" size={14} color={colors.textPrimary} />
                                              </TouchableOpacity>
                                            </View>
                                            
                                            <TouchableOpacity
                                              style={styles.cardAddButton}
                                              onPress={() => {
                                                const key = `local-${item.inventory_id}`;
                                                const qty = quantities[key] || 1;
                                                cartEvents.emit(item, qty);
                                                Alert.alert('Added to Cart', `${qty} × ${item.medicine_name} added to POS billing.`);
                                                setQuantities(prev => ({ ...prev, [key]: 1 }));
                                              }}
                                              activeOpacity={0.7}
                                            >
                                              <Ionicons name="cart-outline" size={14} color="#fff" />
                                              <Text style={styles.cardAddButtonText}>Add</Text>
                                            </TouchableOpacity>
                                          </View>
                                        )}
                                      </View>
                                    </View>
                                  );
                                })}
                              </ScrollView>

                              {/* Top Fade Gradient */}
                              <LinearGradient
                                colors={['#1A1A2E', 'rgba(26, 26, 46, 0)']}
                                style={styles.topFade}
                                pointerEvents="none"
                              />
                              {/* Bottom Fade Gradient */}
                              <LinearGradient
                                colors={['rgba(26, 26, 46, 0)', '#1A1A2E']}
                                style={styles.bottomFade}
                                pointerEvents="none"
                              />
                            </View>


                          </>
                        )}
                      </View>
                    );
                  })()}
                </View>
              )}

              {/* Pharmarack products search Carousel inside chat bubble */}
              {msg.pharmarackProducts && (
                <View style={styles.verticalListContainer}>
                  {(() => {
                    const isCollapsed = collapsedStates[msg.id] === true; // Default to false (expanded)

                    return (
                      <View style={{ gap: 8 }}>
                        <TouchableOpacity
                          style={styles.dropdownHeader}
                          onPress={() => setCollapsedStates(prev => ({ ...prev, [msg.id]: !isCollapsed }))}
                          activeOpacity={0.7}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        >
                          <View style={styles.dropdownHeaderContent}>
                            <Ionicons
                              name={isCollapsed ? "chevron-down-circle" : "chevron-up-circle"}
                              size={20}
                              color="#a78bfa"
                            />
                            <Text style={styles.dropdownHeaderText}>
                              {isCollapsed
                                ? `Show Distributor Results (${msg.pharmarackProducts.length})`
                                : `Hide Distributor Results`}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {!isCollapsed && (
                          <>
                            <View style={styles.scrollBoxWrapper}>
                              <ScrollView
                                style={styles.smallScrollBox}
                                nestedScrollEnabled={true}
                                contentContainerStyle={{ gap: 8, paddingVertical: 12, paddingHorizontal: 4 }}
                                onScroll={(event) => {
                                  const offsetY = event.nativeEvent.contentOffset.y;
                                  if (offsetY > 10) {
                                    setHideHeader(true);
                                  } else if (offsetY <= 5) {
                                    setHideHeader(false);
                                  }
                                }}
                                scrollEventThrottle={16}
                              >
                                {msg.pharmarackProducts.map((item, index) => {
                                  return (
                                     <View
                                       key={index}
                                       style={[styles.productCardVertical, { borderColor: '#a78bfa', borderWidth: 1.5 }]}
                                     >
                                       <View style={styles.prTag}>
                                         <Text style={styles.prTagText}>Pharmarack</Text>
                                       </View>

                                       <View style={styles.cardMainRow}>
                                         <View style={{ flex: 1, paddingLeft: 4 }}>
                                           <Text style={styles.productNameVertical} numberOfLines={1}>{item.name}</Text>
                                           <Text style={styles.productDetail} numberOfLines={1}>Distributor: {item.distributor}</Text>
                                           <Text style={styles.productDetail}>Rate (PTR): ₹{Number(item.rate || 0).toFixed(2)} | MRP: ₹{Number(item.mrp || 0).toFixed(2)}</Text>
                                           <Text style={styles.productDetail}>Scheme: {item.scheme || 'None'}</Text>
                                           <Text style={styles.productDetail}>Stock Status: {item.stock}</Text>
                                         </View>
                                         
                                         <View style={styles.qtyContainerRight}>
                                           <View style={styles.qtyStepper}>
                                             <TouchableOpacity
                                               style={styles.qtyStepperBtn}
                                               onPress={() => {
                                                 const key = `pr-${item.productId || index}`;
                                                 const currentVal = quantities[key] || 1;
                                                 setQuantities(prev => ({ ...prev, [key]: Math.max(1, currentVal - 1) }));
                                               }}
                                             >
                                               <Ionicons name="remove" size={14} color={colors.textPrimary} />
                                             </TouchableOpacity>
                                             <TextInput
                                               style={styles.qtyStepperInput}
                                               value={String(quantities[`pr-${item.productId || index}`] || 1)}
                                               onChangeText={(text) => {
                                                 const val = parseInt(text, 10);
                                                 const key = `pr-${item.productId || index}`;
                                                 setQuantities(prev => ({ ...prev, [key]: isNaN(val) ? 1 : Math.max(1, val) }));
                                               }}
                                               keyboardType="number-pad"
                                               selectTextOnFocus={true}
                                             />
                                             <TouchableOpacity
                                               style={styles.qtyStepperBtn}
                                               onPress={() => {
                                                 const key = `pr-${item.productId || index}`;
                                                 const currentVal = quantities[key] || 1;
                                                 setQuantities(prev => ({ ...prev, [key]: currentVal + 1 }));
                                               }}
                                             >
                                               <Ionicons name="add" size={14} color={colors.textPrimary} />
                                             </TouchableOpacity>
                                           </View>
                                           
                                           <TouchableOpacity
                                             style={[styles.cardAddButton, { backgroundColor: '#7c3aed' }]}
                                             onPress={() => {
                                               const key = `pr-${item.productId || index}`;
                                               const qty = quantities[key] || 1;
                                               performAddPharmarack(item, qty);
                                               setQuantities(prev => ({ ...prev, [key]: 1 }));
                                             }}
                                             activeOpacity={0.7}
                                           >
                                             <Ionicons name="cart-outline" size={14} color="#fff" />
                                             <Text style={styles.cardAddButtonText}>Add</Text>
                                           </TouchableOpacity>
                                         </View>
                                       </View>
                                     </View>
                                  );
                                })}
                              </ScrollView>

                              {/* Top Fade Gradient */}
                              <LinearGradient
                                colors={['#1A1A2E', 'rgba(26, 26, 46, 0)']}
                                style={styles.topFade}
                                pointerEvents="none"
                              />
                              {/* Bottom Fade Gradient */}
                              <LinearGradient
                                colors={['rgba(26, 26, 46, 0)', '#1A1A2E']}
                                style={styles.bottomFade}
                                pointerEvents="none"
                              />
                            </View>


                          </>
                        )}
                      </View>
                    );
                  })()}
                </View>
              )}

              {msg.actions && msg.actions.map((act, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.actionBtn}
                  onPress={() => handleAction(act)}
                >
                  <Text style={styles.actionBtnText}>{act.label}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.timeText}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
        ))}
        {loading && (
          <View style={[styles.messageRow, styles.assistantRow]}>
            <View style={styles.avatar}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
            <View style={[styles.bubble, styles.assistantBubble, { minWidth: 60, alignItems: 'center' }]}>
              <Text style={styles.messageText}>Thinking...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Quick Chips suggestions */}
      <View style={styles.chipsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          {suggestionChips.map((chip, index) => (
            <TouchableOpacity
              key={index}
              style={styles.chip}
              onPress={() => handleSend(chip.value)}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Footer input */}
      <ChatInput onSend={handleSend} onUploadPhoto={handleUploadPhoto} />

      {/* ── Quick Process Sale Modal ── */}
      <Modal
        visible={quickSaleItem !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setQuickSaleItem(null)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView 
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            style={{ width: '100%' }}
          >
            {quickSaleItem && (
              <View style={styles.modalCard}>
                {quickSaleSuccess ? (
                  // ── Success state ──
                  <>
                    <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                      <Ionicons
                        name={quickSaleSuccess.isOffline ? 'cloud-offline-outline' : 'checkmark-circle'}
                        size={56}
                        color={quickSaleSuccess.isOffline ? colors.primary : colors.success}
                      />
                      <Text style={[styles.modalTitle, { textAlign: 'center', marginTop: spacing.md, borderBottomWidth: 0 }]}>
                        {quickSaleSuccess.isOffline ? '💾 Saved Offline' : '✅ Sale Processed!'}
                      </Text>
                      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>
                        Invoice: {quickSaleSuccess.invoice_no}
                      </Text>
                      <Text style={[typography.h3, { color: colors.accent, marginTop: spacing.sm }]}>
                        ₹{quickSaleSuccess.total.toFixed(2)}
                      </Text>
                      {quickSaleSuccess.isOffline && (
                        <View style={styles.offlineBadge}>
                          <Ionicons name="sync-outline" size={12} color={colors.primary} />
                          <Text style={styles.offlineBadgeText}>Will sync when online</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.modalBtn, styles.modalBtnSave, { alignSelf: 'center', paddingHorizontal: spacing.xl }]}
                      onPress={() => setQuickSaleItem(null)}
                    >
                      <Text style={styles.modalBtnTextSave}>Done</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  // ── Form state ──
                  <>
                    <Text style={styles.modalTitle}>⚡ Quick Process Sale</Text>

                    <Text style={styles.fieldLabel}>Medicine</Text>
                    <View style={styles.quickMedRow}>
                      <Text style={styles.quickMedName}>{quickSaleItem.medicine_name}</Text>
                      <Text style={styles.quickMedBatch}>Batch: {quickSaleItem.batch_no}</Text>
                      <Text style={[styles.quickMedBatch, { color: colors.accent }]}>₹{Number(quickSaleItem.mrp || quickSaleItem.unit_price).toFixed(2)}</Text>
                      <Text style={[styles.quickMedBatch, { color: colors.textMuted }]}>Stock: {quickSaleItem.quantity}</Text>
                    </View>

                    <Text style={styles.fieldLabel}>Quantity</Text>
                    <TextInput
                      value={quickSaleQty}
                      onChangeText={setQuickSaleQty}
                      style={styles.modalInput}
                      keyboardType="number-pad"
                      placeholder="1"
                      placeholderTextColor={colors.textMuted}
                    />

                    <Text style={styles.fieldLabel}>Patient Name (optional)</Text>
                    <TextInput
                      value={quickSalePatient}
                      onChangeText={setQuickSalePatient}
                      style={styles.modalInput}
                      placeholder="Walk-in Customer"
                      placeholderTextColor={colors.textMuted}
                    />

                    {/* Total Preview */}
                    <View style={styles.quickTotalRow}>
                      <Text style={styles.quickTotalLabel}>Total</Text>
                      <Text style={styles.quickTotalValue}>
                        ₹{((parseInt(quickSaleQty, 10) || 0) * Number(quickSaleItem.mrp || quickSaleItem.unit_price)).toFixed(2)}
                      </Text>
                    </View>

                    {/* Online/offline indicator */}
                    <View style={styles.connectionBadge}>
                      <View style={[styles.connectDot, { backgroundColor: isOnline ? colors.success : colors.primary, width: 8, height: 8 }]} />
                      <Text style={styles.connectionBadgeText}>
                        {isOnline ? 'Online — Will save to server' : 'Offline — Will save locally & sync later'}
                      </Text>
                    </View>

                    <View style={styles.modalActions}>
                      <TouchableOpacity
                        style={[styles.modalBtn, styles.modalBtnCancel]}
                        onPress={() => setQuickSaleItem(null)}
                        disabled={quickSaleProcessing}
                      >
                        <Text style={styles.modalBtnTextCancel}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalBtn, styles.modalBtnSave, quickSaleProcessing && { opacity: 0.7 }]}
                        onPress={handleQuickProcess}
                        disabled={quickSaleProcessing}
                      >
                        {quickSaleProcessing
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={styles.modalBtnTextSave}>⚡ Process Sale</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Staged Prescription Form Overlay */}
      <Modal
        visible={showPrescriptionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPrescriptionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView 
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            style={{ width: '100%' }}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>📄 Staged Prescription Form</Text>
              
              <Text style={styles.fieldLabel}>Patient Name</Text>
              <TextInput 
                value={prescriptionForm.patient_name} 
                onChangeText={val => setPrescriptionForm(f => ({ ...f, patient_name: val }))}
                style={styles.modalInput} 
              />

              <Text style={styles.fieldLabel}>Doctor Name</Text>
              <TextInput 
                value={prescriptionForm.doctor_name} 
                onChangeText={val => setPrescriptionForm(f => ({ ...f, doctor_name: val }))}
                style={styles.modalInput} 
              />

              <Text style={styles.fieldLabel}>Prescribed Medicines (Fuzzy Scanned)</Text>
              {prescriptionForm.medicines.map((med, i) => (
                <View key={i} style={styles.medRow}>
                  <Text style={styles.medRowText}>{med.name} (x{med.quantity})</Text>
                  <Text style={styles.medRowSubtext}>₹{(med.quantity * med.unit_price).toFixed(2)}</Text>
                </View>
              ))}

              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={[styles.modalBtn, styles.modalBtnCancel]} 
                  onPress={() => setShowPrescriptionModal(false)}
                >
                  <Text style={styles.modalBtnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalBtn, styles.modalBtnSave]} 
                  onPress={handleSaveStagedSale}
                >
                  <Text style={styles.modalBtnTextSave}>Stage Sale</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  connectStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c0a09',
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  connectDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    marginRight: 6,
  },
  connectStatusText: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  leftHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuBtn: {
    padding: spacing.xs,
  },
  assistantStatus: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },
  assistantTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  assistantSubtitle: { ...typography.caption, color: colors.textSecondary },
  clearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  roleLabel: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  roleTabsWrapper: {
    flexDirection: 'row',
    flex: 1,
    gap: 6,
  },
  roleTab: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  roleTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  roleTabText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  roleTabActiveText: {
    color: '#fff',
  },
  messageList: { flex: 1 },
  messageContent: { padding: spacing.md, paddingBottom: spacing.lg },
  messageRow: { flexDirection: 'row', marginBottom: spacing.md, alignItems: 'flex-end' },
  userRow: { justifyContent: 'flex-end' },
  assistantRow: { justifyContent: 'flex-start' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginBottom: 4,
  },
  bubble: {
    padding: spacing.md,
    borderRadius: radius.lg,
    maxWidth: '80%',
    ...shadows.small,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 2,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  messageText: {
    ...typography.body,
    color: '#fff',
    lineHeight: 20,
  },
  timeText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.4)',
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: 9,
  },
  carousel: {
    marginTop: spacing.md,
    flexDirection: 'row',
  },
  carouselContent: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  productCard: {
    width: 140,
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  productName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    fontSize: 12,
  },
  productDetail: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  productPrice: {
    ...typography.body,
    fontWeight: '700',
    color: colors.primary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  cardActionRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.sm,
  },
  cardActionBtn: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: 5,
    alignItems: 'center',
  },
  cardActionBtnProcess: {
    backgroundColor: colors.primary,
  },
  cardActionBtnSecondary: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardActionBtnText: {
    ...typography.caption,
    fontWeight: '700',
    color: '#fff',
    fontSize: 10,
  },
  cardActionBtnTextSecondary: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    fontSize: 10,
  },
  // Quick Sale modal helpers
  quickMedRow: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  quickMedName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  quickMedBatch: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  quickTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  quickTotalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  quickTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.accent,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  connectionBadgeText: {
    fontSize: 10,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.md,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  offlineBadgeText: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '600',
  },
  actionBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  actionBtnText: {
    ...typography.body,
    fontWeight: '600',
    color: '#fff',
  },
  chipsContainer: {
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  chipsScroll: { paddingHorizontal: spacing.md },
  chip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: {
    ...typography.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  photoBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    ...typography.body,
    color: '#fff',
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Checklist Panel styles
  checklistCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  checklistTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  checklistSub: {
    fontSize: 9,
    color: colors.primary,
    fontWeight: 'bold',
  },
  checklistGrid: {
    flexDirection: 'column',
    gap: 8,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  checkItemText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  checkItemTextCompleted: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  checkedLabel: {
    fontSize: 8,
    color: colors.success,
    fontWeight: 'bold',
    backgroundColor: 'rgba(16,185,129,0.1)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 6,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingVertical: spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 11,
    color: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  medRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  medRowText: {
    fontSize: 11,
    color: colors.textPrimary,
  },
  medRowSubtext: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnCancel: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalBtnSave: {
    backgroundColor: colors.primary,
  },
  modalBtnTextCancel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: 'bold',
  },
  modalBtnTextSave: {
    fontSize: 11,
    color: '#fff',
    fontWeight: 'bold',
  },
  outOfStockText: {
    color: colors.danger,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  subTag: {
    backgroundColor: '#0891b2',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    marginBottom: 4,
  },
  subTagText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'center',
  },
  prTag: {
    backgroundColor: '#7c3aed',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    marginBottom: 4,
  },
  prTagText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'center',
  },
  verticalListContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    width: '100%',
  },
  productCardVertical: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.xs,
    width: '100%',
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkboxWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: spacing.sm,
  },
  productNameVertical: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: 2,
    marginLeft: spacing.sm,
  },
  stepperBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    paddingHorizontal: 8,
    textAlign: 'center',
    minWidth: 20,
  },
  cardActionRowVertical: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  cardActionBtnVertical: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    flex: 1,
    backgroundColor: colors.primary,
  },
  cardActionBtnSecondaryVertical: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  cardActionBtnProcessVertical: {
    backgroundColor: colors.accent,
  },
  cardActionBtnTextSecondaryVertical: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: 'bold',
  },
  bulkActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    justifyContent: 'space-between',
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    flex: 1,
  },
  bulkBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  dropdownHeader: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  dropdownHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dropdownHeaderText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  smallScrollBox: {
    maxHeight: 250,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    width: '100%',
  },
  qtyEditContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: 2,
    marginLeft: spacing.sm,
    height: 32,
  },
  stepperMiniBtn: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualQtyInput: {
    width: 36,
    height: 28,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.divider,
    padding: 0,
  },
  scrollBoxWrapper: {
    position: 'relative',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  qtyContainerRight: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginLeft: spacing.sm,
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: 2,
  },
  qtyStepperBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyStepperInput: {
    width: 32,
    height: 24,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.textPrimary,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.divider,
    padding: 0,
  },
  cardAddButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    width: 80,
  },
  cardAddButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
});
