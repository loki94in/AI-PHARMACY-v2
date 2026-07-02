import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import { colors, spacing, typography, radius, shadows } from '../../../lib/theme';
import {
  fetchGmailEmailsDirect,
  getCachedEmails,
  fetchGmailMessageDetail,
  fetchGmailAttachment,
  searchMedicine,
  queueOfflinePurchase,
  SearchMedicineResult,
  GmailMessagePreview,
  getEmailsFromServer,
  getAttachmentPreviewFromServer,
  getServerUrl,
} from '../../../lib/api';

// ── File-type icon config: returns Ionicons name + colors per extension ──
function getFileIconConfig(filename: string): { icon: string; color: string; bg: string; label: string } {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'csv':  return { icon: 'grid-outline',        color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'CSV'  };
    case 'pdf':  return { icon: 'document-text-outline', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'PDF'  };
    case 'xls':
    case 'xlsx': return { icon: 'stats-chart-outline',  color: '#10b981', bg: 'rgba(16,185,129,0.12)',  label: 'XLS'  };
    case 'doc':
    case 'docx': return { icon: 'document-outline',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  label: 'DOC'  };
    case 'zip':
    case 'rar':  return { icon: 'archive-outline',      color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'ZIP'  };
    case 'txt':  return { icon: 'reader-outline',        color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', label: 'TXT'  };
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp': return { icon: 'image-outline',         color: '#a855f7', bg: 'rgba(168,85,247,0.12)',  label: 'IMG'  };
    default:     return { icon: 'attach-outline',        color: '#64748b', bg: 'rgba(100,116,139,0.12)', label: 'FILE' };
  }
}

// ─── Base64 & CSV Parsing Utilities ─────────────────────────────────────────

function decodeBase64(base64: string): string {
  const cleaned = base64.replace(/-/g, '+').replace(/_/g, '/');
  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(
        atob(cleaned)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    }
  } catch (err) {
    console.warn('atob failed, using manual decode:', err);
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = cleaned.length * 0.75;
  if (cleaned[cleaned.length - 1] === '=') {
    bufferLength--;
    if (cleaned[cleaned.length - 2] === '=') {
      bufferLength--;
    }
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const base64val1 = lookup[cleaned.charCodeAt(i)];
    const base64val2 = lookup[cleaned.charCodeAt(i + 1)];
    const base64val3 = lookup[cleaned.charCodeAt(i + 2)];
    const base64val4 = lookup[cleaned.charCodeAt(i + 3)];

    bytes[p++] = (base64val1 << 2) | (base64val2 >> 4);
    if (p < bufferLength) {
      bytes[p++] = ((base64val2 & 15) << 4) | (base64val3 >> 2);
    }
    if (p < bufferLength) {
      bytes[p++] = ((base64val3 & 3) << 6) | (base64val4 & 63);
    }
  }

  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }
}

function decodeBase64Url(str: string): string {
  return decodeBase64(str.replace(/-/g, '+').replace(/_/g, '/'));
}

function getEmailBody(message: any): string {
  if (message && message.bodyText) return message.bodyText;
  let body = '';

  function traverseParts(parts: any[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        body = decodeBase64Url(part.body.data);
        return;
      }
      if (part.parts) {
        traverseParts(part.parts);
      }
    }
  }

  if (message.payload) {
    if (message.payload.mimeType === 'text/plain' && message.payload.body && message.payload.body.data) {
      body = decodeBase64Url(message.payload.body.data);
    } else if (message.payload.parts) {
      traverseParts(message.payload.parts);
    }
  }

  return body || message.snippet || '';
}

function getAttachmentsFromMessage(message: any) {
  const attachments: { id: string; filename: string; mimeType: string; size: number }[] = [];

  function traverseParts(parts: any[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body && part.body.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size || 0,
        });
      }
      if (part.parts) {
        traverseParts(part.parts);
      }
    }
  }

  if (message.payload) {
    if (message.payload.parts) {
      traverseParts(message.payload.parts);
    } else if (message.payload.body && message.payload.body.attachmentId) {
      attachments.push({
        id: message.payload.body.attachmentId,
        filename: message.payload.filename || 'attachment',
        mimeType: message.payload.mimeType || '',
        size: message.payload.body.size || 0,
      });
    }
  }
  return attachments;
}

interface ParsedItem {
  name: string;
  quantity: number;
  rate: number;
  mrp: number;
  batch_no: string;
  expiry_date: string;
}

function parseCSV(csvContent: string): ParsedItem[] {
  const lines = csvContent.split(/\r?\n/);
  if (lines.length === 0) return [];

  // Split headers of the first line
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const items: ParsedItem[] = [];

  // Identify column indices
  let nameIdx = headers.findIndex((h) => h.includes('medicine') || h.includes('name') || h.includes('product') || h.includes('item') || h.includes('desc'));
  let qtyIdx = headers.findIndex((h) => h.includes('qty') || h.includes('quantity') || h.includes('quant'));
  let rateIdx = headers.findIndex((h) => h.includes('rate') || h.includes('price') || h.includes('cost') || h.includes('unit'));
  let mrpIdx = headers.findIndex((h) => h.includes('mrp') || h.includes('max'));
  let batchIdx = headers.findIndex((h) => h.includes('batch') || h.includes('bno') || h.includes('lot'));
  let expiryIdx = headers.findIndex((h) => h.includes('expiry') || h.includes('exp'));

  // Fallbacks
  if (nameIdx === -1) nameIdx = 0;
  if (qtyIdx === -1) qtyIdx = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length <= Math.max(nameIdx, qtyIdx)) continue;

    const name = cols[nameIdx] || '';
    if (!name) continue;

    const quantity = parseInt(cols[qtyIdx], 10) || 0;
    const rate = rateIdx !== -1 ? parseFloat(cols[rateIdx]) || 0 : 0;
    const mrp = mrpIdx !== -1 ? parseFloat(cols[mrpIdx]) || 0 : 0;
    const batch_no = batchIdx !== -1 ? cols[batchIdx] || '' : '';
    const expiry_date = expiryIdx !== -1 ? cols[expiryIdx] || '' : '';

    items.push({
      name,
      quantity,
      rate,
      mrp,
      batch_no,
      expiry_date,
    });
  }
  return items;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const [emails, setEmails] = useState<GmailMessagePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Email Detail View Modal
  const [selectedEmail, setSelectedEmail] = useState<GmailMessagePreview | null>(null);
  const [emailDetail, setEmailDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);

  // Bill Processing Modal
  const [billModalVisible, setBillModalVisible] = useState(false);
  const [distributorName, setDistributorName] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [billDate, setBillDate] = useState('');
  const [billItems, setBillItems] = useState<ParsedItem[]>([]);
  const [processingAttachmentId, setProcessingAttachmentId] = useState<string | null>(null);

  // Medicine Search & Add
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMedicineResult[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);

  // PDF Text Preview Modal
  const [pdfPreviewVisible, setPdfPreviewVisible] = useState(false);
  const [pdfPreviewText, setPdfPreviewText] = useState('');
  const [pdfPreviewFilename, setPdfPreviewFilename] = useState('');

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setErrorText(null);
    try {
      const directEmails = await fetchGmailEmailsDirect();
      setEmails(directEmails);
      setIsOfflineMode(false);
    } catch (err: any) {
      console.warn('Gmail fetch failed, trying to sync from PC server:', err);
      try {
        const serverEmails = await getEmailsFromServer(50);
        const mapped = serverEmails.map((e: any) => ({
          id: String(e.id || e.uid),
          threadId: String(e.uid),
          subject: e.subject || '(No Subject)',
          from: e.from || 'Unknown Sender',
          date: e.date || new Date().toISOString(),
          snippet: e.bodySnippet || e.body || '',
          isFromServer: true,
          body: e.body,
          attachmentFilenames: e.attachmentFilenames || []
        }));
        setEmails(mapped);
        setIsOfflineMode(false);
      } catch (serverErr) {
        console.warn('PC Server fetch also failed, falling back to local storage cache:', serverErr);
        const cached = await getCachedEmails();
        setEmails(cached);
        setIsOfflineMode(true);
        setErrorText('Failed to sync new emails. Displaying offline cached items.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectEmail = async (email: GmailMessagePreview) => {
    setSelectedEmail(email);
    setLoadingDetail(true);
    setEmailDetail(null);
    setAttachments([]);

    if ((email as any).isFromServer) {
      // Already has body and attachment list loaded from PC server database
      setEmailDetail({
        snippet: email.snippet,
        bodyText: (email as any).body || email.snippet,
        payload: {
          body: { data: '' },
          parts: []
        }
      });
      const atts = ((email as any).attachmentFilenames || []).map((filename: string) => ({
        id: filename,
        filename: filename,
        mimeType: filename.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/pdf',
        size: 10240, // 10KB mock size
        isFromServerFile: true
      }));
      setAttachments(atts);
      setLoadingDetail(false);
      return;
    }

    try {
      const detail = await fetchGmailMessageDetail(email.id);
      setEmailDetail(detail);
      const atts = getAttachmentsFromMessage(detail);
      setAttachments(atts);
    } catch (err: any) {
      Alert.alert(
        'Offline / Sync Error',
        'Could not fetch email body details. Showing basic info only. Make sure you have an active network connection to open attachments.'
      );
      setEmailDetail({ snippet: email.snippet });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleProceedAttachment = async (att: any) => {
    if (!selectedEmail) return;
    setProcessingAttachmentId(att.id);

    try {
      const isPdf = att.filename.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        const serverUrl = await getServerUrl();
        if (serverUrl) {
          const pdfUrl = `${serverUrl.replace(/\/+$/, '')}/uploads/${encodeURIComponent(att.filename)}`;
          try {
            await WebBrowser.openBrowserAsync(pdfUrl, {
              readerMode: false,
              enableBarCollapsing: true,
              dismissButtonStyle: 'close',
            });
            setProcessingAttachmentId(null);
            return;
          } catch (browserErr) {
            console.warn('Failed to open PDF in WebBrowser overlay, falling back to system browser:', browserErr);
            const supported = await Linking.canOpenURL(pdfUrl);
            if (supported) {
              await Linking.openURL(pdfUrl);
              setProcessingAttachmentId(null);
              return;
            }
          }
        }

        // Fallback to text preview
        const preview = await getAttachmentPreviewFromServer(att.filename);
        if (preview && preview.success) {
          setPdfPreviewFilename(att.filename);
          setPdfPreviewText(preview.content || 'No text content extracted from PDF.');
          setPdfPreviewVisible(true);
        } else {
          throw new Error(preview?.error || 'Failed to fetch PDF text preview from server');
        }
        return;
      }

      let csvText = '';
      if (att.isFromServerFile) {
        if (att.filename.toLowerCase().endsWith('.csv') || att.filename.toLowerCase().endsWith('.txt')) {
          const preview = await getAttachmentPreviewFromServer(att.filename);
          if (preview && preview.success) {
            csvText = preview.content || '';
          } else {
            throw new Error(preview?.error || 'Failed to fetch file content from server');
          }
        } else {
          Alert.alert(
            'PDF/Excel File Notice',
            'PDF/Excel parsing is handled automatically on the PC panel. You can check in this bill on the PC mail page, or manually enter the items on your phone.',
            [{ text: 'Manual Entry' }]
          );
        }
      } else {
        const base64Data = await fetchGmailAttachment(selectedEmail.id, att.id);
        if (base64Data) {
          csvText = decodeBase64(base64Data);
        }
      }

      // 2. Decode and parse
      let items: ParsedItem[] = [];
      if (att.filename.toLowerCase().endsWith('.csv') && csvText) {
        items = parseCSV(csvText);
      } else {
        Alert.alert(
          'Manual Entry Required',
          `Cannot auto-parse "${att.filename}" directly on mobile. Tapping proceed will let you enter purchase items manually.`,
          [{ text: 'Proceed' }]
        );
      }

      // 3. Prepopulate form
      // Try to clean/extract distributor name from sender "Name <email@site.com>"
      let parsedDistributor = selectedEmail.from;
      const match = selectedEmail.from.match(/^([^<]+)/);
      if (match) {
        parsedDistributor = match[1].trim().replace(/^["']|["']$/g, '');
      }

      // Try to guess invoice number from subject or file name
      let guessedInvoice = '';
      const subjectInvoiceMatch = selectedEmail.subject.match(/(?:inv|invoice|bill)[^\d]*(\d+)/i);
      const fileInvoiceMatch = att.filename.match(/\d+/);
      if (subjectInvoiceMatch) {
        guessedInvoice = subjectInvoiceMatch[1];
      } else if (fileInvoiceMatch) {
        guessedInvoice = fileInvoiceMatch[0];
      }

      setDistributorName(parsedDistributor);
      setInvoiceNo(guessedInvoice);
      setBillDate(new Date(selectedEmail.date).toLocaleDateString('en-IN') || new Date().toLocaleDateString('en-IN'));
      setBillItems(items);

      // 4. Open form modal
      setBillModalVisible(true);
    } catch (err: any) {
      Alert.alert('Processing Error', err.message || 'Failed to download or parse attachment.');
    } finally {
      setProcessingAttachmentId(null);
    }
  };

  const handleSearchMedicines = async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length > 1) {
      const results = await searchMedicine(q);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const handleAddMedicineItem = (medicine: SearchMedicineResult) => {
    // Check if item already in invoice
    const exists = billItems.some((item) => item.name === medicine.medicine_name);
    if (exists) {
      Alert.alert('Duplicate Item', 'This item is already added to the purchase bill.');
      return;
    }

    setBillItems([
      ...billItems,
      {
        name: medicine.medicine_name,
        quantity: 10,
        rate: medicine.cost_price || 0,
        mrp: medicine.mrp || 0,
        batch_no: medicine.batch_no || 'BATCH123',
        expiry_date: medicine.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN'),
      },
    ]);
    setSearchQuery('');
    setSearchResults([]);
    setSearchFocused(false);
  };

  const handleAddCustomItem = () => {
    if (!searchQuery.trim()) return;
    setBillItems([
      ...billItems,
      {
        name: searchQuery.trim(),
        quantity: 10,
        rate: 0,
        mrp: 0,
        batch_no: 'BATCH123',
        expiry_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN'),
      },
    ]);
    setSearchQuery('');
    setSearchResults([]);
    setSearchFocused(false);
  };

  const handleUpdateItemField = (index: number, field: keyof ParsedItem, value: any) => {
    const updated = [...billItems];
    if (field === 'quantity') {
      updated[index].quantity = parseInt(value, 10) || 0;
    } else if (field === 'rate' || field === 'mrp') {
      updated[index][field] = parseFloat(value) || 0;
    } else {
      updated[index][field] = value;
    }
    setBillItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    const updated = [...billItems];
    updated.splice(index, 1);
    setBillItems(updated);
  };

  const handleSavePurchaseBill = async () => {
    if (!distributorName.trim()) {
      Alert.alert('Input Error', 'Please enter a distributor name.');
      return;
    }
    if (!invoiceNo.trim()) {
      Alert.alert('Input Error', 'Please enter an invoice number.');
      return;
    }
    if (billItems.length === 0) {
      Alert.alert('Input Error', 'Please add at least one item to the purchase bill.');
      return;
    }

    // Compute total amount
    const total_amount = billItems.reduce((sum, item) => sum + item.quantity * item.rate, 0);

    const payload = {
      distributor_name: distributorName.trim(),
      invoice_no: invoiceNo.trim(),
      date: new Date().toISOString(),
      total_amount,
      items: billItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        rate: item.rate,
        mrp: item.mrp,
        batch_no: item.batch_no,
        expiry_date: item.expiry_date,
      })),
    };

    try {
      await queueOfflinePurchase(payload);
      
      // Trigger local notification to display global Toast and save to alert history
      Notifications.scheduleNotificationAsync({
        content: {
          title: '📦 Purchase Bill Saved',
          body: `Invoice ${invoiceNo.trim()} for distributor "${distributorName.trim()}" saved to offline sync queue.`,
        },
        trigger: null,
      }).catch(err => console.warn('Failed to trigger purchase notification:', err));

      Alert.alert(
        'Success',
        'Purchase invoice added to offline queue! It will sync automatically when the PC server comes online.',
        [
          {
            text: 'OK',
            onPress: () => {
              setBillModalVisible(false);
              setSelectedEmail(null);
            },
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Failed to save purchase bill.');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[typography.bodySmall, { marginTop: spacing.md, color: colors.textSecondary }]}>
          Loading Gmail Inbox...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isOfflineMode && (
        <View style={styles.warningBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#0F0F1A" />
          <Text style={styles.warningText}>Offline Mode — Showing Cached Mailbox</Text>
        </View>
      )}

      <FlatList
        data={emails}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.emailCard}
            activeOpacity={0.8}
            onPress={() => handleSelectEmail(item)}
          >
            <View style={styles.emailTop}>
              <View style={styles.senderWrap}>
                <View style={styles.envelopeBadge}>
                  <Ionicons name="mail-outline" size={16} color={colors.primary} />
                </View>
                <Text style={styles.senderText} numberOfLines={1}>
                  {item.from}
                </Text>
              </View>
              <Text style={styles.dateText}>{formatDate(item.date)}</Text>
            </View>

            <Text style={styles.subjectText} numberOfLines={1}>
              {item.subject}
            </Text>
            <Text style={styles.snippetText} numberOfLines={2}>
              {item.snippet}
            </Text>

            <View style={styles.cardFooter}>
              <View style={styles.attachmentBadge}>
                <Ionicons name="attach-outline" size={16} color={colors.accent} />
                <Text style={styles.attachmentBadgeText}>Invoice Attachment</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="mail-unread-outline" size={64} color={colors.textMuted} />
            <Text style={[typography.h3, { marginTop: spacing.lg, color: colors.textSecondary }]}>
              Inbox Empty
            </Text>
            <Text style={[typography.bodySmall, { textAlign: 'center', marginTop: spacing.sm, color: colors.textMuted }]}>
              No distributor emails with attachments found in the last 2 days. Make sure you synced Settings from the PC.
            </Text>
          </View>
        }
      />

      {/* ─── EMAIL DETAIL VIEW MODAL ───────────────────────────────────────── */}
      <Modal
        visible={selectedEmail !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedEmail(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={typography.h3}>Distributor Email</Text>
              <TouchableOpacity onPress={() => setSelectedEmail(null)}>
                <Ionicons name="close-circle-outline" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {loadingDetail ? (
              <View style={styles.modalCenter}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[typography.bodySmall, { marginTop: spacing.md }]}>Fetching email content...</Text>
              </View>
            ) : (
              <ScrollView style={styles.modalScroll}>
                {selectedEmail && (
                  <View style={styles.emailDetailMeta}>
                    <Text style={styles.detailLabel}>From:</Text>
                    <Text style={styles.detailValue}>{selectedEmail.from}</Text>

                    <Text style={styles.detailLabel}>Subject:</Text>
                    <Text style={styles.detailValueSubject}>{selectedEmail.subject}</Text>

                    <Text style={styles.detailLabel}>Date:</Text>
                    <Text style={styles.detailValue}>{formatDate(selectedEmail.date)}</Text>
                  </View>
                )}

                <View style={styles.divider} />

                <Text style={styles.detailBodyTitle}>Message body:</Text>
                <Text style={styles.detailBodyText}>
                  {emailDetail ? getEmailBody(emailDetail) : ''}
                </Text>

                <View style={styles.divider} />

                <Text style={styles.attachmentsTitle}>Attachments ({attachments.length}):</Text>

                {attachments.map((att, i) => {
                  const fileIcon = getFileIconConfig(att.filename);
                  return (
                  <View key={i} style={styles.attachmentRow}>
                    <View style={styles.attachmentInfo}>
                      {/* Color-coded file type badge */}
                      <View style={[styles.fileIconBadge, { backgroundColor: fileIcon.bg }]}>
                        <Ionicons name={fileIcon.icon as any} size={20} color={fileIcon.color} />
                        <Text style={[styles.fileIconLabel, { color: fileIcon.color }]}>{fileIcon.label}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: spacing.sm }}>
                        <Text style={styles.attachmentName} numberOfLines={1}>
                          {att.filename}
                        </Text>
                        <Text style={styles.attachmentSize}>
                          {Math.round(att.size / 1024)} KB
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.proceedBtn,
                        processingAttachmentId === att.id && styles.disabledBtn,
                      ]}
                      disabled={processingAttachmentId === att.id}
                      onPress={() => handleProceedAttachment(att)}
                    >
                      {processingAttachmentId === att.id ? (
                        <ActivityIndicator size="small" color={colors.textInverse} />
                      ) : (
                        <>
                          <Text style={styles.proceedBtnText}>
                            {att.filename.toLowerCase().endsWith('.pdf') ? 'Preview' : 'Proceed'}
                          </Text>
                          <Ionicons 
                            name={att.filename.toLowerCase().endsWith('.pdf') ? 'eye-outline' : 'arrow-forward'} 
                            size={14} 
                            color={colors.textInverse} 
                          />
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                  );
                })}

                {attachments.length === 0 && (
                  <Text style={styles.noAttachmentsText}>No file attachments found in this email.</Text>
                )}
                <View style={{ height: spacing.xxl }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ─── PURCHASE BILL VERIFICATION & ENTRY MODAL ───────────────────────── */}
      <Modal
        visible={billModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setBillModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={typography.h2}>Proceed Purchase Bill</Text>
                <Text style={styles.modalSubtitle}>Verify or edit items before saving</Text>
              </View>
              <TouchableOpacity onPress={() => setBillModalVisible(false)}>
                <Ionicons name="close-circle-outline" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {/* Form Metadata */}
              <View style={styles.formCard}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Distributor Name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={distributorName}
                    onChangeText={setDistributorName}
                    placeholder="Enter distributor name"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>

                <View style={styles.formRow}>
                  <View style={[styles.inputGroup, { flex: 1, marginRight: spacing.sm }]}>
                    <Text style={styles.inputLabel}>Invoice No / Bill No</Text>
                    <TextInput
                      style={styles.textInput}
                      value={invoiceNo}
                      onChangeText={setInvoiceNo}
                      placeholder="e.g. INV-9981"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Bill Date</Text>
                    <TextInput
                      style={[styles.textInput, styles.disabledInput]}
                      value={billDate}
                      editable={false}
                    />
                  </View>
                </View>
              </View>

              {/* Items Section */}
              <View style={styles.sectionHeader}>
                <Text style={typography.h3}>Bill Line Items ({billItems.length})</Text>
              </View>

              {/* Add Item Panel */}
              <View style={styles.searchContainer}>
                <View style={styles.searchInputWrap}>
                  <Ionicons name="search-outline" size={18} color={colors.textMuted} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={handleSearchMedicines}
                    onFocus={() => setSearchFocused(true)}
                    placeholder="Search medicine to add to invoice..."
                    placeholderTextColor={colors.textMuted}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => handleSearchMedicines('')}>
                      <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {searchFocused && searchQuery.length > 0 && (
                  <View style={styles.searchResultsPanel}>
                    {searchResults.map((med, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.searchResultRow}
                        onPress={() => handleAddMedicineItem(med)}
                      >
                        <View>
                          <Text style={styles.searchResultName}>{med.medicine_name}</Text>
                          <Text style={styles.searchResultMeta}>
                            Batch: {med.batch_no || 'None'} | Expiry: {med.expiry_date || 'N/A'}
                          </Text>
                        </View>
                        <Ionicons name="add-circle" size={24} color={colors.accent} />
                      </TouchableOpacity>
                    ))}
                    {searchResults.length === 0 && (
                      <TouchableOpacity style={styles.searchResultRow} onPress={handleAddCustomItem}>
                        <Text style={[styles.searchResultName, { color: colors.primary }]}>
                          Add Custom: "{searchQuery}"
                        </Text>
                        <Ionicons name="add-circle" size={24} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* Items List */}
              {billItems.map((item, index) => (
                <View key={index} style={styles.itemEditorCard}>
                  <View style={styles.itemEditorTop}>
                    <Text style={styles.itemEditorName} numberOfLines={1}>
                      {index + 1}. {item.name}
                    </Text>
                    <TouchableOpacity onPress={() => handleRemoveItem(index)}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.itemRowFields}>
                    <View style={[styles.inputGroup, { flex: 1.2, marginRight: spacing.xs }]}>
                      <Text style={styles.fieldLabel}>Qty</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={String(item.quantity)}
                        keyboardType="numeric"
                        onChangeText={(val) => handleUpdateItemField(index, 'quantity', val)}
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1.5, marginRight: spacing.xs }]}>
                      <Text style={styles.fieldLabel}>Cost Rate (₹)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={String(item.rate)}
                        keyboardType="numeric"
                        onChangeText={(val) => handleUpdateItemField(index, 'rate', val)}
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1.5, marginRight: spacing.xs }]}>
                      <Text style={styles.fieldLabel}>MRP (₹)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={String(item.mrp)}
                        keyboardType="numeric"
                        onChangeText={(val) => handleUpdateItemField(index, 'mrp', val)}
                      />
                    </View>
                  </View>

                  <View style={styles.itemRowFields}>
                    <View style={[styles.inputGroup, { flex: 1.5, marginRight: spacing.xs }]}>
                      <Text style={styles.fieldLabel}>Batch No</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={item.batch_no}
                        onChangeText={(val) => handleUpdateItemField(index, 'batch_no', val)}
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1.8 }]}>
                      <Text style={styles.fieldLabel}>Expiry Date</Text>
                      <TextInput
                        style={styles.fieldInput}
                        value={item.expiry_date}
                        placeholder="MM/YY"
                        onChangeText={(val) => handleUpdateItemField(index, 'expiry_date', val)}
                      />
                    </View>
                  </View>
                </View>
              ))}

              {billItems.length === 0 && (
                <View style={styles.emptyItemsCard}>
                  <Text style={styles.emptyItemsText}>No items added yet. Search a medicine above to populate invoice lines.</Text>
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>

            {/* Bill Action Footer */}
            <View style={styles.billFooter}>
              <View style={styles.totalSumWrap}>
                <Text style={styles.totalSumLabel}>Total Est. Amount:</Text>
                <Text style={styles.totalSumVal}>
                  ₹
                  {billItems
                    .reduce((sum, item) => sum + item.quantity * item.rate, 0)
                    .toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.saveBillBtn}
                onPress={handleSavePurchaseBill}
              >
                <Ionicons name="cube-outline" size={20} color={colors.textInverse} />
                <Text style={styles.saveBillBtnText}>Queue Purchase Bill</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── PDF TEXT PREVIEW MODAL ───────────────────────────────────────── */}
      <Modal
        visible={pdfPreviewVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPdfPreviewVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, marginRight: spacing.md }}>
                <Text style={typography.h3} numberOfLines={1}>PDF Text Preview</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>{pdfPreviewFilename}</Text>
              </View>
              <TouchableOpacity onPress={() => setPdfPreviewVisible(false)}>
                <Ionicons name="close-circle-outline" size={28} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.pdfTextContainer}>
                <Text style={styles.pdfBoldText}>
                  {pdfPreviewText}
                </Text>
              </View>
              <View style={{ height: spacing.xxl }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  modalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.warning,
    paddingVertical: spacing.xs + 2,
  },
  warningText: { color: '#0F0F1A', fontSize: 12, fontWeight: '700' },
  emailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...shadows.small,
  },
  emailTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  senderWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  envelopeBadge: { backgroundColor: colors.shimmer, padding: 6, borderRadius: radius.full },
  senderText: { ...typography.body, color: colors.textSecondary, fontWeight: '600', flex: 1 },
  dateText: { ...typography.caption },
  subjectText: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginVertical: spacing.xs },
  snippetText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
  cardFooter: { flexDirection: 'row', justifyContent: 'flex-start' },
  attachmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 217, 166, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  attachmentBadgeText: { fontSize: 11, fontWeight: '600', color: colors.accent },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, marginTop: 80 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    height: '80%',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalContentLarge: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    height: '95%',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: spacing.md,
  },
  modalSubtitle: { ...typography.bodySmall, color: colors.textMuted },
  modalScroll: { flex: 1 },
  emailDetailMeta: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
  detailLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  detailValue: { ...typography.body, color: colors.textPrimary },
  detailValueSubject: { ...typography.body, fontWeight: '700', color: colors.accent },
  detailBodyTitle: { ...typography.label, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  detailBodyText: { ...typography.body, color: colors.textSecondary, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, minHeight: 100 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.lg },
  attachmentsTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  attachmentInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  attachmentName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  attachmentSize: { ...typography.caption },
  fileIconBadge: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  fileIconLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  proceedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    ...shadows.small,
  },
  disabledBtn: { backgroundColor: colors.textMuted },
  proceedBtnText: { ...typography.bodySmall, color: colors.textInverse, fontWeight: '700' },
  noAttachmentsText: { ...typography.bodySmall, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.md },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  inputGroup: { gap: 4 },
  inputLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  textInput: {
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.sm,
    padding: spacing.sm,
    fontSize: 14,
  },
  disabledInput: { backgroundColor: colors.divider, color: colors.textSecondary },
  formRow: { flexDirection: 'row' },
  sectionHeader: { marginTop: spacing.xl, marginBottom: spacing.md },
  searchContainer: { marginBottom: spacing.md, zIndex: 10 },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  searchIcon: { marginRight: spacing.xs },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 10, fontSize: 14 },
  searchResultsPanel: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    ...shadows.card,
  },
  searchResultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  searchResultName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  searchResultMeta: { ...typography.caption },
  itemEditorCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  itemEditorTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  itemEditorName: { ...typography.body, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  itemRowFields: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  fieldLabel: { fontSize: 11, color: colors.textMuted },
  fieldInput: {
    backgroundColor: colors.bg,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
  },
  emptyItemsCard: { padding: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  emptyItemsText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  billFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalSumWrap: { flex: 1 },
  totalSumLabel: { ...typography.caption },
  totalSumVal: { ...typography.h2, color: colors.accent },
  saveBillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    ...shadows.card,
  },
  saveBillBtnText: { ...typography.body, color: colors.textInverse, fontWeight: '700' },
  pdfTextContainer: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pdfBoldText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 26,
    fontFamily: Platform.OS === 'ios' ? 'Helvetica' : 'monospace',
  },
});
