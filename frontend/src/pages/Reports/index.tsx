import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  BarChart3, 
  TrendingUp, 
  Download, 
  IndianRupee, 
  ShoppingBag, 
  Package, 
  FileText, 
  Info, 
  Calendar, 
  Search, 
  Loader2, 
  Clock, 
  AlertTriangle,
  History,
  FileCheck2,
  PieChart,
  Boxes,
  HelpCircle,
  Undo2,
  Percent,
  Users,
  Send,
  FileSpreadsheet,
  X
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiClient } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { getTodayString, getNDaysAgoString, toDateInputValue } from '../../utils/date';
import { exportToCSV, exportToPDF } from '../../utils/export';

// Module-level cache for instant report hydration on tab switches / re-mounts
const cachedReportsMap: Record<string, { summary: any; records: any[] }> = {};
const cachedNonMovingMap: Record<number, any> = {};

const Reports = () => {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(getNDaysAgoString(30));
  const [toDate, setToDate] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') || 'sales') as 'sales' | 'inventory' | 'purchases' | 'expiry' | 'nonMoving' | 'trace';

  const setActiveTab = (tab: string) => {
    setSearchParams((prev) => {
      prev.set('tab', tab);
      return prev;
    });
  };

  useEffect(() => {
    if (activeTab === 'expiry') {
      setFromDate(getTodayString());
      setToDate(getNDaysAgoString(-365));
      setManualToDate(true);
    }
  }, [activeTab]);

  const setPresetRange = (preset: '30d' | '1y' | 'all' | 'expiry365') => {
    if (preset === '30d') {
      setFromDate(getNDaysAgoString(30));
      setToDate(getTodayString());
      setManualToDate(false);
    } else if (preset === '1y') {
      setFromDate(getNDaysAgoString(365));
      setToDate(getTodayString());
      setManualToDate(false);
    } else if (preset === 'all') {
      setFromDate('1970-01-01');
      setToDate(getTodayString());
      setManualToDate(false);
    } else if (preset === 'expiry365') {
      setFromDate(getTodayString());
      setToDate(getNDaysAgoString(-365));
      setManualToDate(true);
    }
  };
  
  // Non-moving report local settings
  const [nonMovingDays, setNonMovingDays] = useState(200);
  const [localNonMovingDays, setLocalNonMovingDays] = useState(200);
  const [nonMovingSearchQuery, setNonMovingSearchQuery] = useState('');

  // Product trace local query state
  const [traceQuery, setTraceQuery] = useState('');
  const [appliedTraceQuery, setAppliedTraceQuery] = useState('');
  const [traceData, setTraceData] = useState<{ purchases: any[]; sales: any[] }>({ purchases: [], sales: [] });
  const [loadingTrace, setLoadingTrace] = useState(false);

  // WhatsApp & PDF Dispatch State
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [sendingSamples, setSendingSamples] = useState(false);

  // Complete Report Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'csv'>('csv');
  const [exportSplitMode, setExportSplitMode] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleDownloadExport = async () => {
    setIsExporting(true);
    try {
      if (activeTab === 'trace') {
        alert('Product Trace cannot be exported directly. Use print/screenshot or export standard inventory logs.');
        setIsExporting(false);
        return;
      }

      let exportData: any[] = [];
      let exportColumns: Array<{ key: string; label: string }> = [];
      let reportTitle = `${activeTab.toUpperCase()} Report`;

      if (activeTab === 'nonMoving') {
        exportData = filteredNonMovingItems;
        reportTitle = `Non-Moving Inventory Report (${nonMovingDays}+ Days Inactive)`;
        exportColumns = [
          { key: 'medicineName', label: 'Medicine Name' },
          { key: 'batchNo', label: 'Batch No' },
          { key: 'purchaseDate', label: 'Purchase Date' },
          { key: 'quantity', label: 'Stock Qty' },
          { key: 'expiryDate', label: 'Expiry Date' },
          { key: 'costPrice', label: 'Unit Cost (Rs.)' },
          { key: 'totalCostValue', label: 'Hold Value Cost (Rs.)' },
          { key: 'totalValue', label: 'Hold Value MRP (Rs.)' },
          { key: 'dormantDaysLabel', label: 'Dormant Period' }
        ];
      } else if (activeTab === 'sales') {
        exportData = records;
        reportTitle = `Sales History Report (${fromDate} to ${toDate})`;
        exportColumns = [
          { key: 'date', label: 'Date' },
          { key: 'invoice_no', label: 'Invoice Number' },
          { key: 'total_amount', label: 'Total Amount (Rs.)' }
        ];
      } else if (activeTab === 'purchases') {
        exportData = records;
        reportTitle = `Purchase Log Bills Report (${fromDate} to ${toDate})`;
        exportColumns = [
          { key: 'date', label: 'Date' },
          { key: 'invoice_no', label: 'Bill / Invoice No' },
          { key: 'distributor_name', label: 'Distributor Supplier' },
          { key: 'total_amount', label: 'Amount (Rs.)' }
        ];
      } else if (activeTab === 'inventory') {
        exportData = records;
        reportTitle = `Valued Inventory Status Report`;
        exportColumns = [
          { key: 'medicine_name', label: 'Medicine Stock Name' },
          { key: 'batch_no', label: 'Batch No' },
          { key: 'stock', label: 'Current Stock Qty' },
          { key: 'cost_price', label: 'Unit Cost (Rs.)' },
          { key: 'mrp', label: 'Unit MRP (Rs.)' },
          { key: 'value', label: 'Hold Valuation Cost (Rs.)' }
        ];
      } else if (activeTab === 'expiry') {
        exportData = records;
        reportTitle = `Expiry Warning Report (${fromDate} to ${toDate})`;
        exportColumns = [
          { key: 'medicine_name', label: 'Medicine Name' },
          { key: 'batch_no', label: 'Batch Number' },
          { key: 'quantity', label: 'Stock Qty' },
          { key: 'cost_price', label: 'Unit Cost (Rs.)' },
          { key: 'expiry_date', label: 'Expiry Date' },
          { key: 'value', label: 'Valuation at Risk (Rs.)' }
        ];
      }

      if (exportSplitMode && exportData.length > 0) {
        // Multi-file export mode: generate & download separate files for each 30 items chunk
        const filename = `report_${activeTab}_split30_${Date.now()}`;
        if (exportFormat === 'pdf') {
          exportToPDF(exportData, exportColumns, filename, reportTitle, { split: true, itemsPerPage: 30 });
        } else {
          exportToCSV(exportData, exportColumns, filename, { split: true, itemsPerPage: 30 });
        }
      } else {
        // Single file download mode
        let blob: Blob;
        if (activeTab === 'nonMoving') {
          if (exportFormat === 'pdf') {
            blob = await api.exportReportsPDF({ type: 'nonMoving', days: nonMovingDays });
          } else {
            blob = await api.exportReportsCSV({ type: 'nonMoving', days: nonMovingDays });
          }
        } else {
          if (exportFormat === 'pdf') {
            blob = await api.exportReportsPDF({ type: activeTab, fromDate, toDate });
          } else {
            blob = await api.exportReportsCSV({ type: activeTab, fromDate, toDate });
          }
        }
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${activeTab}_${Date.now()}.${exportFormat === 'pdf' ? 'pdf' : 'csv'}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
      setShowExportModal(false);
    } catch (err) {
      console.error(`Error exporting ${exportFormat}:`, err);
      alert(`Failed to export ${exportFormat.toUpperCase()} report.`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = (format: 'pdf' | 'csv' = 'csv') => {
    setExportFormat(format);
    setShowExportModal(true);
  };

  const handleSendToWhatsapp = async (overrideFormat?: string) => {
    setSendingWhatsapp(true);
    try {
      const res = await apiClient.post('/reports/send-monthly-scheduled', {
        type: 'custom',
        startDate: fromDate,
        endDate: toDate,
        deliveryFormat: overrideFormat || 'combined'
      });
      if (res.data?.success) {
        alert('Report sent successfully to WhatsApp!');
      } else {
        alert(res.data?.message || 'Failed to send report');
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Error sending report via WhatsApp');
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const handleSendAllTemplateSamples = async () => {
    setSendingSamples(true);
    try {
      const res = await apiClient.post('/reports/send-all-template-samples', {});
      if (res.data?.success) {
        alert('All 3 PDF Template Samples (Classic, Corporate, Executive) queued & sent to WhatsApp!');
      } else {
        alert(res.data?.message || 'Failed to send PDF samples');
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Error sending PDF samples via WhatsApp');
    } finally {
      setSendingSamples(false);
    }
  };

  const handleDownloadPdfReport = () => {
    const url = `/api/reports/monthly-scheduled-preview?type=custom&startDate=${fromDate}&endDate=${toDate}&download=pdf`;
    window.open(url, '_blank');
  };

  useEffect(() => {
    if (!manualToDate) {
      setToDate(getTodayString());
    }
  }, [manualToDate]);

  const handleFromDateChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setFromDate('2020-01-01');
    } else {
      setFromDate(val);
    }
  };

  const handleToDateChange = (val: string) => {
    if (val && val < '2020-01-01') {
      setToDate('2020-01-01');
    } else {
      setToDate(val);
    }
  };

  const cacheKeyStr = `${activeTab}:${fromDate}:${toDate}`;

  // Main reports query (sales, purchases, inventory, expiry) - enabled by default so it auto-loads
  const { data: reportData = cachedReportsMap[cacheKeyStr], isLoading: loading, isError, refetch } = useApiQuery<{
    summary: any;
    records: any[];
  }>(
    ['reports', activeTab, fromDate, toDate],
    async () => {
      // Don't query default endpoints if tab is nonMoving or trace
      if (activeTab === 'nonMoving' || activeTab === 'trace') {
        const summaryData = await api.getReportsSummary({ type: activeTab, fromDate, toDate });
        const result = { summary: summaryData, records: [] };
        if (summaryData) cachedReportsMap[cacheKeyStr] = result;
        return result;
      }

      const [summaryData, tableData] = await Promise.all([
        api.getReportsSummary({ type: activeTab, fromDate, toDate }),
        api.getReportsData({ type: activeTab, fromDate, toDate })
      ]);
      const result = { summary: summaryData, records: Array.isArray(tableData) ? tableData : [] };
      if (summaryData && Array.isArray(tableData)) cachedReportsMap[cacheKeyStr] = result;
      return result;
    },
    { 
      enabled: true,
      staleTime: 300000,
      initialData: cachedReportsMap[cacheKeyStr] || undefined,
      refetchOnWindowFocus: false
    }
  );

  // Non-Moving Inventory query
  const { data: nonMovingData = cachedNonMovingMap[nonMovingDays], isLoading: loadingNonMoving, refetch: refetchNonMoving } = useApiQuery<{
    success: boolean;
    periodDays: number;
    count: number;
    items: any[];
  }>(
    ['reports', 'nonMoving', nonMovingDays],
    async () => {
      const result = await api.getNonMovingReportData({ days: nonMovingDays });
      if (result) cachedNonMovingMap[nonMovingDays] = result;
      return result;
    },
    { 
      enabled: activeTab === 'nonMoving',
      staleTime: 300000,
      initialData: cachedNonMovingMap[nonMovingDays] || undefined,
      refetchOnWindowFocus: false
    }
  );

  // Fetch product trace data
  const handleTraceSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!traceQuery.trim()) return;

    setLoadingTrace(true);
    setAppliedTraceQuery(traceQuery);
    try {
      const res = await api.getProductTrace({ q: traceQuery });
      setTraceData(res);
    } catch (err) {
      console.error('Error fetching product trace:', err);
    } finally {
      setLoadingTrace(false);
    }
  };

  useEffect(() => {
    const handleReportUpdate = () => {
      Object.keys(cachedReportsMap).forEach(k => delete cachedReportsMap[k]);
      refetch();
    };
    window.addEventListener('stock-write-completed', handleReportUpdate);
    window.addEventListener('price-updated', handleReportUpdate);
    return () => {
      window.removeEventListener('stock-write-completed', handleReportUpdate);
      window.removeEventListener('price-updated', handleReportUpdate);
    };
  }, [refetch]);

  const handleGenerate = (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (activeTab === 'nonMoving') {
      delete cachedNonMovingMap[localNonMovingDays];
      queryClient.removeQueries({ queryKey: ['reports', 'nonMoving', localNonMovingDays] });
      queryClient.invalidateQueries({ queryKey: ['reports', 'nonMoving', localNonMovingDays] });
      setNonMovingDays(localNonMovingDays);
      refetchNonMoving();
    } else if (activeTab === 'trace') {
      handleTraceSearch();
    } else {
      delete cachedReportsMap[cacheKeyStr];
      queryClient.removeQueries({ queryKey: ['reports', activeTab, fromDate, toDate] });
      queryClient.invalidateQueries({ queryKey: ['reports', activeTab, fromDate, toDate] });
      refetch();
    }
  };



  const stats = reportData?.summary ?? {};
  const records = reportData?.records ?? [];

  const filteredNonMovingItems = (nonMovingData?.items ?? []).filter((item: any) => {
    if (!nonMovingSearchQuery.trim()) return true;
    const q = nonMovingSearchQuery.toLowerCase().trim();
    return (item.medicineName && item.medicineName.toLowerCase().includes(q)) ||
           (item.batchNo && item.batchNo.toLowerCase().includes(q));
  });

  // Calculate dynamic stats based on active tab
  const getStatsCards = () => {
    if (activeTab === 'nonMoving') {
      const deadItems = nonMovingData?.items ?? [];
      const totalDeadValuation = deadItems.reduce((acc: number, item: any) => acc + (item.totalValue || 0), 0);
      const totalDeadCostValuation = deadItems.reduce((acc: number, item: any) => acc + (item.totalCostValue || 0), 0);
      const neverMovedCount = deadItems.filter((item: any) => item.daysSinceLastTransaction === 999).length;

      return [
        {
          label: 'Inactive Medicines',
          value: deadItems.length.toLocaleString('en-IN'),
          icon: Boxes,
          color: 'amber',
          gradient: 'rgba(245,158,11,0.12)',
          desc: `No sales in ${nonMovingDays} days`
        },
        {
          label: 'Locked Capital (Cost)',
          value: `₹${totalDeadCostValuation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: IndianRupee,
          color: 'red',
          gradient: 'rgba(239,68,68,0.12)',
          desc: 'Valued at purchase cost'
        },
        {
          label: 'Locked Capital (MRP)',
          value: `₹${totalDeadValuation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: TrendingUp,
          color: 'sky',
          gradient: 'rgba(14,165,233,0.12)',
          desc: 'Retail value of non-moving stock'
        },
        {
          label: 'Never Sold Items',
          value: neverMovedCount.toLocaleString('en-IN'),
          icon: HelpCircle,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Zero transactions recorded'
        }
      ];
    }

    if (activeTab === 'trace') {
      const purchaseCount = traceData.purchases.length;
      const saleCount = traceData.sales.length;
      return [
        {
          label: 'Search Parameter',
          value: appliedTraceQuery ? `"${appliedTraceQuery}"` : 'None',
          icon: Search,
          color: 'primary',
          gradient: 'rgba(34,197,150,0.12)',
          desc: 'Current trace search query'
        },
        {
          label: 'Matching Purchases',
          value: purchaseCount.toLocaleString('en-IN'),
          icon: ShoppingBag,
          color: 'amber',
          gradient: 'rgba(245,158,11,0.12)',
          desc: 'Incoming batches logged'
        },
        {
          label: 'Matching Sales',
          value: saleCount.toLocaleString('en-IN'),
          icon: FileText,
          color: 'green',
          gradient: 'rgba(34,197,150,0.12)',
          desc: 'Outgoing retail sales logged'
        },
        {
          label: 'Trace Health',
          value: (purchaseCount + saleCount) > 0 ? 'Active' : 'Idle',
          icon: History,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Real-time database index search'
        }
      ];
    }

    if (activeTab === 'sales') {
      return [
        {
          label: 'Total Revenue',
          value: `₹${(stats.totalSales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: IndianRupee,
          color: 'green',
          gradient: 'rgba(34,197,150,0.12)',
          desc: 'Accumulated invoices'
        },
        {
          label: 'Cost of Goods Sold (COGS)',
          value: `₹${(stats.cogs || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: ShoppingBag,
          color: 'sky',
          gradient: 'rgba(14,165,233,0.12)',
          desc: 'Cost value of medicines sold'
        },
        {
          label: 'Net Profit',
          value: `₹${(stats.netProfit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: TrendingUp,
          color: 'amber',
          gradient: 'rgba(245,158,11,0.12)',
          desc: 'Revenue minus COGS'
        },
        {
          label: 'Profit Margin',
          value: `${stats.profitMargin || 0}%`,
          icon: Percent,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Profit margin percentage'
        }
      ];
    }

    if (activeTab === 'purchases') {
      return [
        {
          label: 'Total Purchases Cost',
          value: `₹${(stats.totalPurchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: ShoppingBag,
          color: 'sky',
          gradient: 'rgba(14,165,233,0.12)',
          desc: 'Supplier bills registered'
        },
        {
          label: 'Items Purchased',
          value: (stats.itemsPurchased || 0).toLocaleString('en-IN'),
          icon: Package,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Total inventory items stocked'
        },
        {
          label: 'Suppliers/Distributors',
          value: (stats.suppliersCount || 0).toLocaleString('en-IN'),
          icon: Users,
          color: 'green',
          gradient: 'rgba(34,197,150,0.12)',
          desc: 'Distinct suppliers in period'
        },
        {
          label: 'Avg Price per Item',
          value: `₹${(stats.avgItemPrice || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: IndianRupee,
          color: 'amber',
          gradient: 'rgba(245,158,11,0.12)',
          desc: 'Average purchase price per item'
        }
      ];
    }

    if (activeTab === 'inventory') {
      return [
        {
          label: 'Total Stock sitting',
          value: (stats.totalStock || 0).toLocaleString('en-IN'),
          icon: Package,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Total units currently in stock'
        },
        {
          label: 'Total Hold Value (Cost)',
          value: `₹${(stats.holdValuationCost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: IndianRupee,
          color: 'green',
          gradient: 'rgba(34,197,150,0.12)',
          desc: 'Stock valued at purchase cost'
        },
        {
          label: 'Total Hold Value (MRP)',
          value: `₹${(stats.holdValuationMrp || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: TrendingUp,
          color: 'sky',
          gradient: 'rgba(14,165,233,0.12)',
          desc: 'Stock valued at retail MRP'
        },
        {
          label: 'Unique Medicines',
          value: (stats.uniqueMedicines || 0).toLocaleString('en-IN'),
          icon: Boxes,
          color: 'amber',
          gradient: 'rgba(245,158,11,0.12)',
          desc: 'Different medicine lines in stock'
        }
      ];
    }

    if (activeTab === 'expiry') {
      return [
        {
          label: 'Expiring Items Qty',
          value: (stats.expiringStockQty || 0).toLocaleString('en-IN'),
          icon: Package,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Total units expiring soon'
        },
        {
          label: 'Cost Value at Risk',
          value: `₹${(stats.expiringCostValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: IndianRupee,
          color: 'red',
          gradient: 'rgba(239,68,68,0.12)',
          desc: 'Total loss if stock expires (Cost)'
        },
        {
          label: 'MRP Value at Risk',
          value: `₹${(stats.expiringMrpValue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: TrendingUp,
          color: 'amber',
          gradient: 'rgba(245,158,11,0.12)',
          desc: 'Total retail value at risk (MRP)'
        },
        {
          label: 'Unique Medicines',
          value: (stats.expiringMedicines || 0).toLocaleString('en-IN'),
          icon: Boxes,
          color: 'sky',
          gradient: 'rgba(14,165,233,0.12)',
          desc: 'Unique medicines expiring soon'
        }
      ];
    }

    return [];
  };

  const tabs = [
    { id: 'sales', label: 'Sales Reports', icon: FileText, color: 'text-green', activeBg: 'bg-green/10 text-green border-green/20' },
    { id: 'purchases', label: 'Purchase Reports', icon: ShoppingBag, color: 'text-amber', activeBg: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    { id: 'inventory', label: 'Inventory Reports', icon: Package, color: 'text-sky', activeBg: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
    { id: 'expiry', label: 'Expiry Reports', icon: BarChart3, color: 'text-red', activeBg: 'bg-red/10 text-red border-red/20' },
    { id: 'nonMoving', label: 'Non-Moving Inventory', icon: PieChart, color: 'text-purple-400', activeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    { id: 'trace', label: 'Product Trace & Audit', icon: History, color: 'text-teal-400', activeBg: 'bg-teal-500/10 text-teal-400 border-teal-500/20' },
  ] as const;

  const colorMap: Record<string, string> = {
    green: 'text-green',
    sky: 'text-sky-400',
    amber: 'text-amber-500',
    primary: 'text-primary',
    purple: 'text-purple-400',
    red: 'text-red',
  };

  const borderMap: Record<string, string> = {
    green: 'border-green/30 hover:border-green/50',
    sky: 'border-sky-500/30 hover:border-sky-500/50',
    amber: 'border-amber-500/30 hover:border-amber-500/50',
    primary: 'border-primary/30 hover:border-primary/50',
    purple: 'border-purple-500/30 hover:border-purple-500/50',
    red: 'border-red/30 hover:border-red/50',
  };

  return (
    <div className="h-full flex flex-col gap-4 min-h-0 overflow-hidden text-text bg-bg p-4 animate-in fade-in duration-300">
      
      {/* Sleek Compact Top Bar & Filters Header */}
      <div className="flex flex-col gap-3 bg-bg2 border border-border p-3.5 px-4 rounded-2xl flex-shrink-0 shadow-sm">
        {/* Row 1: Title & Tab Switcher Pills */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Title */}
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
              <PieChart size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-text leading-none">Analytics & Reports Hub</h1>
              <p className="text-[11px] text-muted mt-0.5">
                {activeTab === 'nonMoving' 
                  ? 'Identify dormant stock & valuation loss metrics' 
                  : activeTab === 'trace' 
                  ? 'Trace transactions for Batch, Invoice, or supplier parameters'
                  : 'Live financial ledger analyzer & inventory valuation'}
              </p>
            </div>
          </div>

          {/* Single Primary Tab Switcher */}
          <div className="flex items-center gap-1 bg-bg3/40 p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 font-semibold text-xs rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-bg2 text-primary font-bold shadow-sm border border-border'
                      : 'text-muted hover:text-text hover:bg-bg3/80 border border-transparent'
                  }`}
                >
                  <Icon size={14} className={isActive ? 'text-primary' : 'text-muted'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Compact Filter Controls & Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-border/50">
          {/* Filter Inputs (Standard Date Range / NonMoving / Trace) */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {activeTab !== 'nonMoving' && activeTab !== 'trace' && (
              <>
                <div className="flex items-center gap-1 bg-bg3/50 border border-border p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setPresetRange(activeTab === 'expiry' ? 'expiry365' : '30d')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg hover:bg-bg2 text-muted hover:text-text transition-all cursor-pointer"
                  >
                    {activeTab === 'expiry' ? 'Upcoming 1Yr' : '30 Days'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetRange('1y')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg hover:bg-bg2 text-muted hover:text-text transition-all cursor-pointer"
                  >
                    1 Year
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetRange('all')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg hover:bg-bg2 text-muted hover:text-text transition-all cursor-pointer"
                  >
                    All Time
                  </button>
                </div>

                <div className="flex items-center gap-1.5 bg-bg3/50 border border-border px-3 py-1 rounded-xl text-xs">
                  <span className="text-muted text-[11px] font-medium">From:</span>
                  <input
                    type="date"
                    min="2020-01-01"
                    className="bg-transparent text-text text-xs focus:outline-none font-medium cursor-pointer"
                    value={toDateInputValue(fromDate)}
                    onChange={(e) => handleFromDateChange(e.target.value)}
                    aria-label="From Date"
                  />
                </div>

                <div className="flex items-center gap-1.5 bg-bg3/50 border border-border px-3 py-1 rounded-xl text-xs">
                  <span className="text-muted text-[11px] font-medium">To:</span>
                  <input
                    type="date"
                    min="2020-01-01"
                    disabled={!manualToDate}
                    className="bg-transparent text-text text-xs focus:outline-none font-medium disabled:opacity-50 cursor-pointer"
                    value={toDateInputValue(toDate)}
                    onChange={(e) => handleToDateChange(e.target.value)}
                    aria-label="To Date"
                  />
                  <label className="text-[10px] text-muted flex items-center gap-1 cursor-pointer select-none border-l border-border pl-2 ml-1">
                    <input
                      type="checkbox"
                      checked={manualToDate}
                      onChange={e => setManualToDate(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary/20 bg-bg3"
                    />
                    <span>Edit</span>
                  </label>
                </div>
              </>
            )}

            {activeTab === 'nonMoving' && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Filter medicine or batch..."
                    className="pl-9 pr-3 py-1.5 bg-bg3/50 border border-border rounded-xl text-text text-xs focus:outline-none focus:border-primary w-56"
                    value={nonMovingSearchQuery}
                    onChange={(e) => setNonMovingSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 bg-bg3/50 border border-border px-3 py-1 rounded-xl text-xs">
                  <span className="text-muted text-[11px] font-medium">Inactive ({'>='} Days):</span>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    className="w-16 bg-bg border border-border rounded-lg text-text text-xs focus:outline-none px-2 py-0.5 font-bold text-center"
                    value={localNonMovingDays}
                    onChange={(e) => setLocalNonMovingDays(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
              </div>
            )}

            {activeTab === 'trace' && (
              <form onSubmit={handleTraceSearch} className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Enter Batch, Invoice, or Distributor..."
                    className="pl-9 pr-3 py-1.5 bg-bg3/50 border border-border rounded-xl text-text text-xs focus:outline-none focus:border-primary w-64"
                    value={traceQuery}
                    onChange={(e) => setTraceQuery(e.target.value)}
                  />
                </div>
              </form>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleGenerate}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer shrink-0"
              title="Generate Report Data"
            >
              <BarChart3 size={13} />
              <span>Generate</span>
            </button>

            <button
              type="button"
              onClick={() => handleSendToWhatsapp('combined')}
              disabled={sendingWhatsapp}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer shrink-0"
              title="Send PDF & Graph Report to Owner WhatsApp"
            >
              <Send size={13} />
              <span>{sendingWhatsapp ? 'Sending...' : 'Send WhatsApp'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="bg-bg3 border border-border hover:bg-bg3/80 text-text font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer shrink-0"
              title="Export Complete Report (PDF / Excel Format)"
            >
              <Download size={13} />
              <span>Export Report</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Summary KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
        {getStatsCards().map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="bg-bg2 border border-border rounded-xl p-3 flex items-center justify-between shadow-sm">
              <div>
                <div className="text-[10px] text-muted font-bold uppercase tracking-wider">{card.label}</div>
                <div className="text-lg font-black text-text font-mono tracking-tight mt-0.5">
                  {card.value}
                </div>
                <div className="text-[10px] text-muted mt-0.5 truncate max-w-[180px]">
                  {card.desc}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-bg3 border border-border text-primary shrink-0">
                <Icon size={16} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-bg2 border border-border rounded-2xl shadow-sm">
          {isError && (
            <div className="m-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-between text-xs text-red-400 font-semibold shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0 text-red-400" />
                <span>Failed to fetch report data from server. Please check date filters or database connection.</span>
              </div>
              <button
                onClick={() => refetch()}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                Retry
              </button>
            </div>
          )}
          
          {/* SALES TAB */}
          {activeTab === 'sales' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/30 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text">
                  <FileText size={15} className="text-green" />
                  <span>Sales Ledger Invoices</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendToWhatsapp('combined')}
                    disabled={sendingWhatsapp}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                    title="Send Sales Report to Owner WhatsApp"
                  >
                    <Send size={12} />
                    <span>{sendingWhatsapp ? 'Sending...' : 'Send WhatsApp'}</span>
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileSpreadsheet size={12} />
                    <span>CSV</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Date</th>
                      <th className="p-3.5 border-b border-glass-border/20">Invoice Number</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Loading sales dataset...</span>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-16 text-center text-xs text-muted">
                          <AlertTriangle className="mx-auto mb-3 opacity-30 text-amber-500" size={28} />
                          <p className="font-bold">No sales invoices found</p>
                          <p className="text-[10px] mt-0.5">There are no sales logs recorded in the selected date boundaries.</p>
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-mono font-bold text-muted">{row.date ? row.date.substring(0, 10) : '—'}</td>
                          <td className="p-3.5 font-semibold text-text">{row.invoice_no || '—'}</td>
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-text">₹{(row.total_amount || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PURCHASES TAB */}
          {activeTab === 'purchases' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/30 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text">
                  <ShoppingBag size={15} className="text-amber-500" />
                  <span>Purchase Log Bills</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendToWhatsapp('combined')}
                    disabled={sendingWhatsapp}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                    title="Send Purchase Log Report to Owner WhatsApp"
                  >
                    <Send size={12} />
                    <span>{sendingWhatsapp ? 'Sending...' : 'Send WhatsApp'}</span>
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileSpreadsheet size={12} />
                    <span>CSV</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Date</th>
                      <th className="p-3.5 border-b border-glass-border/20">Bill / Invoice No</th>
                      <th className="p-3.5 border-b border-glass-border/20">Distributor Supplier</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Loading purchase dataset...</span>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-16 text-center text-xs text-muted">
                          <AlertTriangle className="mx-auto mb-3 opacity-30 text-amber-500" size={28} />
                          <p className="font-bold">No purchase bills found</p>
                          <p className="text-[10px] mt-0.5">There are no incoming stock purchases recorded in this date range.</p>
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-mono font-bold text-muted">{row.date ? row.date.substring(0, 10) : '—'}</td>
                          <td className="p-3.5 font-semibold text-text">{row.invoice_no || '—'}</td>
                          <td className="p-3.5 text-text font-medium">{row.distributor || '—'}</td>
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-text">₹{(row.total_amount || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* INVENTORY TAB */}
          {activeTab === 'inventory' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/30 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text">
                  <Package size={15} className="text-sky-400" />
                  <span>Valued Inventory Status</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendToWhatsapp('combined')}
                    disabled={sendingWhatsapp}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                    title="Send Valued Inventory Report to Owner WhatsApp"
                  >
                    <Send size={12} />
                    <span>{sendingWhatsapp ? 'Sending...' : 'Send WhatsApp'}</span>
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileSpreadsheet size={12} />
                    <span>CSV</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Medicine Stock Name</th>
                      <th className="p-3.5 border-b border-glass-border/20">Batch No</th>
                      <th className="p-3.5 border-b border-glass-border/20">Current Stock Qty</th>
                      <th className="p-3.5 border-b border-glass-border/20">Unit Cost (₹)</th>
                      <th className="p-3.5 border-b border-glass-border/20">Unit MRP (₹)</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Hold Valuation (Cost)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Loading inventory metrics...</span>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-16 text-center text-xs text-muted">
                          <AlertTriangle className="mx-auto mb-3 opacity-30 text-amber-500" size={28} />
                          <p className="font-bold">No inventory master records</p>
                          <p className="text-[10px] mt-0.5">No stock is registered in the database catalog.</p>
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-bold text-text">{row.medicine_name || '—'}</td>
                          <td className="p-3.5 font-mono text-muted">{row.batch_no || 'N/A'}</td>
                          <td className="p-3.5 font-mono font-semibold text-text">{row.stock ?? 0}</td>
                          <td className="p-3.5 font-mono text-text">₹{(row.cost_price || 0).toFixed(2)}</td>
                          <td className="p-3.5 font-mono text-text">₹{(row.mrp || 0).toFixed(2)}</td>
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-text">₹{(row.value || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* EXPIRY TAB */}
          {activeTab === 'expiry' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/30 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text">
                  <BarChart3 size={15} className="text-red" />
                  <span>Expiry Warning Ledger Forecast</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendToWhatsapp('combined')}
                    disabled={sendingWhatsapp}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                    title="Send Expiry Report to Owner WhatsApp"
                  >
                    <Send size={12} />
                    <span>{sendingWhatsapp ? 'Sending...' : 'Send WhatsApp'}</span>
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileSpreadsheet size={12} />
                    <span>CSV</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Medicine Name</th>
                      <th className="p-3.5 border-b border-glass-border/20">Batch Number</th>
                      <th className="p-3.5 border-b border-glass-border/20">Stock Qty</th>
                      <th className="p-3.5 border-b border-glass-border/20">Unit Cost (₹)</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-red font-bold">Expiry Date</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Valuation at Risk (Cost)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Loading expiry warning lists...</span>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-16 text-center text-xs text-muted">
                          <AlertTriangle className="mx-auto mb-3 opacity-30 text-amber-500" size={28} />
                          <p className="font-bold">No expiry alerts registered</p>
                          <p className="text-[10px] mt-0.5">No medicine batch is expiring within the specified timeline.</p>
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-bold text-text">{row.medicine_name || '—'}</td>
                          <td className="p-3.5 font-mono font-semibold text-muted">{row.batch_no || '—'}</td>
                          <td className="p-3.5 font-mono text-text">{row.quantity ?? 0}</td>
                          <td className="p-3.5 font-mono text-text">₹{(row.cost_price || 0).toFixed(2)}</td>
                          <td className="p-3.5 font-mono font-black text-red">{row.expiry_date || '—'}</td>
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-red">₹{(row.value || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* NON-MOVING INVENTORY TAB */}
          {activeTab === 'nonMoving' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-border flex justify-between items-center bg-bg2/40 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text" title="Rows are per inventory batch. If the same medicine name has multiple medicine records (duplicates are not auto-merged), each is listed separately rather than combined into one line.">
                  <PieChart size={15} className="text-purple-400" />
                  <span>Dormant / Non-Moving Stock (Inactive for {nonMovingDays} days)</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendToWhatsapp('combined')}
                    disabled={sendingWhatsapp}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                    title="Send Non-Moving Stock Report to Owner WhatsApp"
                  >
                    <Send size={12} />
                    <span>{sendingWhatsapp ? 'Sending...' : 'Send WhatsApp'}</span>
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileSpreadsheet size={12} />
                    <span>CSV</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-border shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-border/50 pl-5">Medicine Name</th>
                      <th className="p-3.5 border-b border-border/50">Batch</th>
                      <th className="p-3.5 border-b border-border/50">Purchase Date</th>
                      <th className="p-3.5 border-b border-border/50">Quantity</th>
                      <th className="p-3.5 border-b border-border/50">Expiry Date</th>
                      <th className="p-3.5 border-b border-border/50">Unit Cost (₹)</th>
                      <th className="p-3.5 border-b border-border/50">Hold Value (Cost)</th>
                      <th className="p-3.5 border-b border-border/50">Hold Value (MRP)</th>
                      <th className="p-3.5 border-b border-border/50 text-right pr-5">Dormant Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingNonMoving ? (
                      <tr>
                        <td colSpan={9} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Calculating dormant items...</span>
                        </td>
                      </tr>
                    ) : filteredNonMovingItems.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-16 text-center text-xs text-muted">
                          <FileCheck2 className="mx-auto mb-3 opacity-30 text-green" size={28} />
                          <p className="font-bold">No matching dormant items found</p>
                          <p className="text-[10px] mt-0.5">
                            {nonMovingSearchQuery.trim()
                              ? `No inactive stock matched "${nonMovingSearchQuery}".`
                              : `All stock items have transaction activity in the last ${nonMovingDays} days.`}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredNonMovingItems.map((row: any, idx: number) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-bold text-text">{row.medicineName || '—'}</td>
                          <td className="p-3.5 font-mono font-semibold text-muted">{row.batchNo || 'N/A'}</td>
                          <td className="p-3.5 font-mono text-muted/90">{row.purchaseDate || '—'}</td>
                          <td className="p-3.5 font-mono text-text">{row.quantity ?? 0}</td>
                          <td className="p-3.5 font-mono font-bold text-amber-400">{row.expiryDate || 'N/A'}</td>
                          <td className="p-3.5 font-mono text-text">₹{(row.costPrice || 0).toFixed(2)}</td>
                          <td className="p-3.5 font-mono text-text">₹{(row.totalCostValue || 0).toFixed(2)}</td>
                          <td className="p-3.5 font-mono font-bold text-text">₹{(row.totalValue || 0).toFixed(2)}</td>
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-amber-500">
                            {row.daysSinceLastTransaction} days
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PRODUCT TRACE / AUDIT TAB */}
          {activeTab === 'trace' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/30 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text">
                  <History size={15} className="text-teal-400 animate-pulse" />
                  <span>Real-time Ledger Trace (Fuzzy Match Index)</span>
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4.5 custom-scrollbar bg-bg2/10 flex flex-col gap-5">
                {!appliedTraceQuery ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-muted py-16">
                    <Search className="opacity-20 mb-3 text-primary animate-bounce" size={42} />
                    <h4 className="text-sm font-bold text-text">Product Audit Search Engine</h4>
                    <p className="text-xs max-w-sm mt-1">
                      Type a medicine name, batch number, distributor, or invoice number in the search bar above to trace all associated purchases and retail sales logs.
                    </p>
                  </div>
                ) : loadingTrace ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-muted py-16">
                    <Loader2 className="animate-spin text-primary mb-3" size={32} />
                    <span className="font-bold text-xs">Querying database transaction tables...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
                    
                    {/* purchases traces list */}
                    <div className="bg-bg2 border border-glass-border/40 rounded-2xl p-4 flex flex-col min-h-[300px] shadow-sm">
                      <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3 mb-3">
                        <ShoppingBag size={14} className="text-amber-500" />
                        <h4 className="text-xs font-black uppercase tracking-wider text-text">Associated Purchase Invoices ({traceData.purchases.length})</h4>
                      </div>
                      <div className="flex flex-col gap-3 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                        {traceData.purchases.length === 0 ? (
                          <div className="py-12 text-center text-[11px] text-muted">
                            No incoming purchase orders match this trace target.
                          </div>
                        ) : (
                          traceData.purchases.map((row, idx) => (
                            <div key={idx} className="p-3 bg-bg3/25 border border-glass-border/40 rounded-xl hover:border-glass-border/80 transition-colors flex flex-col gap-1.5">
                              <div className="flex justify-between items-start">
                                <span className="font-bold text-text text-xs">{row.medicine_name}</span>
                                <span className="font-mono text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded">
                                  Batch: {row.batch_no || 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-muted font-bold font-mono">
                                <span>Bill: {row.invoice_no}</span>
                                <span>Distributor: {row.distributor_name}</span>
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-muted border-t border-glass-border/20 pt-1.5 mt-0.5">
                                <span>Qty: {row.quantity} boxes</span>
                                <span className="font-bold text-text">Cost: ₹{row.cost_price} | MRP: ₹{row.mrp}</span>
                                <span className="text-[9px] text-muted/60">{row.transaction_date?.substring(0, 10)}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* sales traces list */}
                    <div className="bg-bg2 border border-glass-border/40 rounded-2xl p-4 flex flex-col min-h-[300px] shadow-sm">
                      <div className="flex items-center gap-2 border-b border-glass-border/30 pb-3 mb-3">
                        <FileText size={14} className="text-green" />
                        <h4 className="text-xs font-black uppercase tracking-wider text-text">Associated Retail Sales ({traceData.sales.length})</h4>
                      </div>
                      <div className="flex flex-col gap-3 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                        {traceData.sales.length === 0 ? (
                          <div className="py-12 text-center text-[11px] text-muted">
                            No retail sale invoices match this trace target.
                          </div>
                        ) : (
                          traceData.sales.map((row, idx) => (
                            <div key={idx} className="p-3 bg-bg3/25 border border-glass-border/40 rounded-xl hover:border-glass-border/80 transition-colors flex flex-col gap-1.5">
                              <div className="flex justify-between items-start">
                                <span className="font-bold text-text text-xs">{row.medicine_name}</span>
                                <span className="font-mono text-[9px] bg-green/10 border border-green/20 text-green px-1.5 py-0.5 rounded">
                                  Batch: {row.batch_no || 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-muted font-bold font-mono">
                                <span>Invoice: {row.invoice_no}</span>
                                <span>Customer: {row.customer_name || 'Walk-in Customer'}</span>
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-muted border-t border-glass-border/20 pt-1.5 mt-0.5">
                                <span>Qty: {row.quantity} sold</span>
                                <span className="font-bold text-text">Unit Price: ₹{row.unit_price}</span>
                                <span className="text-[9px] text-muted/60">{row.transaction_date?.substring(0, 10)}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      {/* EXPORT COMPLETE REPORT MODAL DIALOG */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-bg2 border border-glass-border rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-glass-border/40 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Download size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-text">Export Complete Report</h3>
                  <p className="text-[10px] text-muted font-medium">Select desired file format for full dataset download</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="text-muted hover:text-text p-1.5 rounded-lg hover:bg-bg3/60 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Active Context Details */}
            <div className="bg-bg3/40 border border-glass-border/30 rounded-xl p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted font-mono">Report Context</span>
                <span className="text-[11px] font-bold text-primary capitalize">{activeTab} Report</span>
              </div>
              <p className="text-xs text-text font-semibold">
                {activeTab === 'nonMoving'
                  ? `Non-Moving Inventory (${nonMovingDays}+ Days Inactive)`
                  : activeTab === 'trace'
                  ? `Product Trace Ledger Audit`
                  : `${fromDate} to ${toDate}`}
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-muted pt-1 border-t border-glass-border/20 mt-1">
                <Info size={12} className="text-purple-400 shrink-0" />
                <span>Exports all matching database records without page truncation.</span>
              </div>
            </div>

            {/* File Format Selection Cards */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-muted uppercase tracking-wider block">Choose File Format</label>
              
              <div className="grid grid-cols-2 gap-3">
                {/* PDF Option */}
                <button
                  type="button"
                  onClick={() => setExportFormat('pdf')}
                  className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                    exportFormat === 'pdf'
                      ? 'bg-purple-500/10 border-purple-500 text-purple-300 ring-1 ring-purple-500/50 shadow-md'
                      : 'bg-bg3/30 border-glass-border text-muted hover:bg-bg3/60 hover:text-text'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <FileText size={22} className={exportFormat === 'pdf' ? 'text-purple-400' : 'text-muted'} />
                    {exportFormat === 'pdf' && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-text">PDF Document</h4>
                    <p className="text-[10px] text-muted mt-0.5"> Branded PDF Report (.pdf)</p>
                  </div>
                </button>

                {/* CSV Option */}
                <button
                  type="button"
                  onClick={() => setExportFormat('csv')}
                  className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                    exportFormat === 'csv'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/50 shadow-md'
                      : 'bg-bg3/30 border-glass-border text-muted hover:bg-bg3/60 hover:text-text'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <FileSpreadsheet size={22} className={exportFormat === 'csv' ? 'text-emerald-400' : 'text-muted'} />
                    {exportFormat === 'csv' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-text">CSV Spreadsheet</h4>
                    <p className="text-[10px] text-muted mt-0.5">Raw Data Rows (.csv)</p>
                  </div>
                </button>
              </div>
            </div>

            {/* File & List Splitting Choice */}
            <div className="space-y-2.5 pt-2 border-t border-glass-border/30">
              <label className="text-xs font-bold text-muted uppercase tracking-wider block">List Splitting Mode</label>
              
              <div className="flex flex-col gap-2">
                <label className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  !exportSplitMode
                    ? 'bg-purple-500/10 border-purple-500/60 text-text ring-1 ring-purple-500/30'
                    : 'bg-bg3/30 border-glass-border/30 text-muted hover:bg-bg3/60'
                }`}>
                  <input
                    type="radio"
                    name="splitMode"
                    checked={!exportSplitMode}
                    onChange={() => setExportSplitMode(false)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-bold text-text">Single File (All Products in 1 File)</div>
                    <div className="text-[10px] text-muted mt-0.5">Export all products & medicines in 1 single file</div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  exportSplitMode
                    ? 'bg-purple-500/10 border-purple-500/60 text-text ring-1 ring-purple-500/30'
                    : 'bg-bg3/30 border-glass-border/30 text-muted hover:bg-bg3/60'
                }`}>
                  <input
                    type="radio"
                    name="splitMode"
                    checked={exportSplitMode}
                    onChange={() => setExportSplitMode(true)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-bold text-text">Split into Multiple Files (30 Products per File)</div>
                    <div className="text-[10px] text-muted mt-0.5">Downloads separate individual files for every 30 products</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-glass-border/40 pt-4">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3/60 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDownloadExport}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 active:scale-95 transition-all shadow-md shadow-purple-600/25 flex items-center gap-2 cursor-pointer"
              >
                <Download size={14} />
                <span>Download {exportFormat.toUpperCase()} File</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Reports;
