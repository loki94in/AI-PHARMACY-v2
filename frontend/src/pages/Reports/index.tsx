import { useState, useEffect, useRef } from 'react';
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
  Undo2
} from 'lucide-react';
import { api } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { getTodayString, getNDaysAgoString } from '../../utils/date';

const Reports = () => {
  const [fromDate, setFromDate] = useState(getNDaysAgoString(30));
  const [toDate, setToDate] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'purchases' | 'expiry' | 'nonMoving' | 'trace'>('sales');
  
  // Non-moving report local settings
  const [nonMovingDays, setNonMovingDays] = useState(90);
  const [localNonMovingDays, setLocalNonMovingDays] = useState(90);

  // Product trace local query state
  const [traceQuery, setTraceQuery] = useState('');
  const [appliedTraceQuery, setAppliedTraceQuery] = useState('');
  const [traceData, setTraceData] = useState<{ purchases: any[]; sales: any[] }>({ purchases: [], sales: [] });
  const [loadingTrace, setLoadingTrace] = useState(false);

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

  // Main reports query (sales, purchases, inventory, expiry) - enabled by default so it auto-loads
  const { data: reportData, isLoading: loading, refetch } = useApiQuery<{
    summary: { totalSales: number; totalPurchases: number; profitMargin: number; itemsSold: number };
    records: any[];
  }>(
    ['reports', activeTab, fromDate, toDate],
    async () => {
      // Don't query default endpoints if tab is nonMoving or trace
      if (activeTab === 'nonMoving' || activeTab === 'trace') {
        const summaryData = await api.getReportsSummary({ fromDate, toDate });
        return { summary: summaryData, records: [] };
      }

      const [summaryData, tableData] = await Promise.all([
        api.getReportsSummary({ fromDate, toDate }),
        api.getReportsData({ type: activeTab, fromDate, toDate })
      ]);
      return { summary: summaryData, records: tableData };
    },
    { 
      enabled: true,
      refetchOnWindowFocus: false
    }
  );

  // Non-Moving Inventory query
  const { data: nonMovingData, isLoading: loadingNonMoving, refetch: refetchNonMoving } = useApiQuery<{
    success: boolean;
    periodDays: number;
    count: number;
    items: any[];
  }>(
    ['reports', 'nonMoving', nonMovingDays],
    async () => {
      return api.getNonMovingReportData({ days: nonMovingDays });
    },
    { 
      enabled: activeTab === 'nonMoving',
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

  const handleGenerate = () => {
    if (activeTab === 'nonMoving') {
      setNonMovingDays(localNonMovingDays);
      refetchNonMoving();
    } else if (activeTab === 'trace') {
      handleTraceSearch();
    } else {
      refetch();
    }
  };

  const handleExport = async (format: 'pdf' | 'excel') => {
    try {
      let blob;
      if (activeTab === 'nonMoving') {
        alert('Exporting custom non-moving inventory logs...');
        return;
      }
      if (activeTab === 'trace') {
        alert('Product Trace cannot be exported directly. Use print/screenshot or export standard inventory logs.');
        return;
      }

      if (format === 'pdf') {
        blob = await api.exportReportsPDF({ type: activeTab, fromDate, toDate });
      } else {
        blob = await api.exportReportsExcel({ type: activeTab, fromDate, toDate });
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${activeTab}_${Date.now()}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(`Error exporting ${format}:`, err);
      alert(`Failed to export ${format} report.`);
    }
  };

  const stats = reportData?.summary ?? { totalSales: 0, totalPurchases: 0, profitMargin: 0, itemsSold: 0 };
  const records = reportData?.records ?? [];

  // Calculate dynamic stats based on active tab
  const getStatsCards = () => {
    if (activeTab === 'nonMoving') {
      const deadItems = nonMovingData?.items ?? [];
      const totalDeadValuation = deadItems.reduce((acc, item) => acc + (item.totalValue || 0), 0);
      const neverMovedCount = deadItems.filter(item => item.daysSinceLastTransaction === 999).length;

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
          label: 'Locked Capital Valuation',
          value: `₹${totalDeadValuation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          icon: IndianRupee,
          color: 'red',
          gradient: 'rgba(239,68,68,0.12)',
          desc: 'Valued at MRP prices'
        },
        {
          label: 'Never Sold Items',
          value: neverMovedCount.toLocaleString('en-IN'),
          icon: HelpCircle,
          color: 'purple',
          gradient: 'rgba(168,85,247,0.12)',
          desc: 'Zero transactions recorded'
        },
        {
          label: 'Target Liquidation',
          value: deadItems.slice(0, 5).length > 0 ? `${deadItems.slice(0, 5).length} Items` : '0 Items',
          icon: TrendingUp,
          color: 'sky',
          gradient: 'rgba(14,165,233,0.12)',
          desc: 'High priority actions recommended'
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

    // Default dashboard metrics
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
        label: 'Total Purchases',
        value: `₹${(stats.totalPurchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        icon: ShoppingBag,
        color: 'sky',
        gradient: 'rgba(14,165,233,0.12)',
        desc: 'Supplier bills registered'
      },
      {
        label: 'Average Profit Margin',
        value: `${stats.profitMargin || 0}%`,
        icon: TrendingUp,
        color: 'amber',
        gradient: 'rgba(245,158,11,0.12)',
        desc: 'Based on item purchase costs'
      },
      {
        label: 'Items Sold',
        value: (stats.itemsSold || 0).toLocaleString('en-IN'),
        icon: Package,
        color: 'purple',
        gradient: 'rgba(168,85,247,0.12)',
        desc: 'Total inventory items dispatched'
      }
    ];
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
    <div className="h-full flex flex-col gap-5 min-h-0 overflow-hidden text-text bg-bg p-1 animate-in fade-in duration-300">
      
      {/* Dynamic Date Controls & Custom Toolbars */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-bg2 border border-border/80 p-4 rounded-2xl flex-shrink-0 shadow-lg relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 left-0 w-2 h-full bg-primary" />
        
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-primary/10 border border-primary/20 rounded-xl text-primary shadow-inner">
            <PieChart size={18} className="animate-spin-slow" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-black text-text uppercase tracking-widest">Reports Workspace</span>
            <span className="text-[10px] text-muted font-bold">
              {activeTab === 'nonMoving' 
                ? 'Identify dormant stock & valuation loss metrics' 
                : activeTab === 'trace' 
                ? 'Trace transactions for Batch, Invoice, or supplier parameters'
                : 'Live financial ledger analyzer'}
            </span>
          </div>
        </div>

        <div className="flex gap-3 items-center flex-wrap w-full md:w-auto justify-end">
          {/* Controls for Standard Date Filter Tabs */}
          {activeTab !== 'nonMoving' && activeTab !== 'trace' && (
            <>
              <div className="flex items-center gap-2 text-[10px] text-muted font-black uppercase tracking-wider bg-bg3/60 border border-glass-border px-3 py-1.5 rounded-xl">
                <span>From</span>
                <input
                  type="date"
                  min="2020-01-01"
                  max={getTodayString()}
                  className="bg-transparent border-none text-text text-xs focus:outline-none focus:ring-0 font-mono font-bold cursor-pointer"
                  value={fromDate}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                  aria-label="From Date"
                />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted font-black uppercase tracking-wider bg-bg3/60 border border-glass-border px-3 py-1.5 rounded-xl">
                <span>To</span>
                <input
                  type="date"
                  min="2020-01-01"
                  max={getTodayString()}
                  disabled={!manualToDate}
                  className="bg-transparent border-none text-text text-xs focus:outline-none focus:ring-0 font-mono font-bold disabled:opacity-50 cursor-pointer"
                  value={toDate}
                  onChange={(e) => handleToDateChange(e.target.value)}
                  aria-label="To Date"
                />
                <label className="text-[9px] text-muted flex items-center gap-1 cursor-pointer select-none border-l border-glass-border pl-2 ml-1">
                  <input
                    type="checkbox"
                    checked={manualToDate}
                    onChange={e => setManualToDate(e.target.checked)}
                    className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg3"
                  />
                  <span>Edit</span>
                </label>
              </div>
            </>
          )}

          {/* Controls for Non-Moving dead stock filter */}
          {activeTab === 'nonMoving' && (
            <div className="flex items-center gap-2.5 text-[10px] text-muted font-black uppercase tracking-wider bg-bg3/60 border border-glass-border px-3 py-1.5 rounded-xl">
              <span>Dormancy Period</span>
              <select
                value={localNonMovingDays}
                onChange={e => setLocalNonMovingDays(Number(e.target.value))}
                className="bg-transparent border-none text-text text-xs focus:outline-none focus:ring-0 font-bold cursor-pointer pr-5 font-mono"
              >
                <option value={30}>30 Days (Slow)</option>
                <option value={60}>60 Days (Inactive)</option>
                <option value={90}>90 Days (Stagnant)</option>
                <option value={120}>120 Days (Critical)</option>
                <option value={180}>180 Days (Dead Stock)</option>
              </select>
            </div>
          )}

          {/* Controls for Product Trace Search input */}
          {activeTab === 'trace' && (
            <form onSubmit={handleTraceSearch} className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-3 top-2.5 text-muted" />
                <input
                  type="text"
                  placeholder="Enter Batch, Invoice, or Distributor..."
                  value={traceQuery}
                  onChange={e => setTraceQuery(e.target.value)}
                  className="bg-bg3 border border-glass-border rounded-xl pl-8 pr-3 py-1.5 text-xs text-text placeholder-muted/60 focus:outline-none focus:border-primary/50 w-64 transition-all font-bold"
                />
              </div>
            </form>
          )}

          <button
            onClick={handleGenerate}
            className="bg-primary hover:bg-primary/95 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-all active:scale-95 shadow-md shadow-primary/25 cursor-pointer shrink-0 h-9"
            title="Generate Report"
          >
            <BarChart3 size={13} />
            <span>Generate</span>
          </button>
        </div>
      </div>

      {/* Dynamic Summary KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0 animate-in fade-in duration-300">
        {getStatsCards().map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className={`bg-glass-bg border ${borderMap[card.color]} rounded-2xl p-4.5 relative overflow-hidden group shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300`}>
              <div
                className="absolute top-0 right-0 w-24 h-24 translate-x-6 -translate-y-6 pointer-events-none rounded-full blur-xl"
                style={{ background: `radial-gradient(circle, ${card.gradient} 0%, transparent 70%)` }}
              />
              <div className="flex justify-between items-start mb-2">
                <div className="text-[10px] text-muted font-black uppercase tracking-wider">{card.label}</div>
                <span className={`p-2 rounded-xl bg-bg2 border border-glass-border/30 ${colorMap[card.color]}`}>
                  <Icon size={14} className="group-hover:scale-110 transition-transform duration-300" />
                </span>
              </div>
              <div className={`text-2xl font-black ${colorMap[card.color]} font-mono tracking-tight`}>
                {card.value}
              </div>
              <div className="text-[9px] text-muted/70 font-bold mt-1.5 tracking-wide">
                {card.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Split Panel Area */}
      <div className="flex-1 flex gap-5 min-h-0 overflow-hidden">
        
        {/* Left Selector Sidebar */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-2 bg-glass-bg border border-border/80 rounded-2xl p-3.5 overflow-y-auto scrollbar-thin shadow-lg">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-muted px-2.5 mb-2">Report Modules</h3>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border text-xs font-bold transition-all text-left cursor-pointer group ${
                  isActive
                    ? `${tab.activeBg} font-black shadow-sm`
                    : 'bg-bg3/20 border-glass-border/40 text-muted hover:text-text hover:bg-bg3/60'
                }`}
              >
                <Icon size={16} className={`shrink-0 transition-transform group-hover:scale-105 duration-200 ${isActive ? tab.color : 'text-muted'}`} />
                <span className="flex-1 truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Content Table Panel */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-glass-bg border border-border/80 rounded-2xl shadow-xl">
          
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
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <Download size={12} />
                    <span>Excel</span>
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
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <Download size={12} />
                    <span>Excel</span>
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
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <Download size={12} />
                    <span>Excel</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Medicine Stock Name</th>
                      <th className="p-3.5 border-b border-glass-border/20">Current Stock Qty</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Hold Valuation (Cost)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Loading inventory metrics...</span>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-16 text-center text-xs text-muted">
                          <AlertTriangle className="mx-auto mb-3 opacity-30 text-amber-500" size={28} />
                          <p className="font-bold">No inventory master records</p>
                          <p className="text-[10px] mt-0.5">No stock is registered in the database catalog.</p>
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-bold text-text">{row.medicine_name || '—'}</td>
                          <td className="p-3.5 font-mono font-semibold text-text">{row.stock ?? 0}</td>
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
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <FileCheck2 size={12} />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                  >
                    <Download size={12} />
                    <span>Excel</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Medicine Name</th>
                      <th className="p-3.5 border-b border-glass-border/20">Batch Number</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Loading expiry warning lists...</span>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-16 text-center text-xs text-muted">
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
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-red">{row.expiry_date || '—'}</td>
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
              <div className="p-4 border-b border-glass-border/30 flex justify-between items-center bg-bg2/30 flex-shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-text">
                  <PieChart size={15} className="text-purple-400" />
                  <span>Dormant / Non-Moving Stock (Inactive for {nonMovingDays} days)</span>
                </h3>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border/30 shadow-sm z-10">
                    <tr className="text-muted/80 text-[10px] font-black uppercase tracking-wider">
                      <th className="p-3.5 border-b border-glass-border/20 pl-5">Medicine Name</th>
                      <th className="p-3.5 border-b border-glass-border/20">Batch</th>
                      <th className="p-3.5 border-b border-glass-border/20">Quantity</th>
                      <th className="p-3.5 border-b border-glass-border/20">MRP (₹)</th>
                      <th className="p-3.5 border-b border-glass-border/20">Hold Valuation</th>
                      <th className="p-3.5 border-b border-glass-border/20 text-right pr-5">Dormant Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingNonMoving ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-xs text-muted">
                          <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={20} />
                          <span className="font-bold">Calculating dormant items...</span>
                        </td>
                      </tr>
                    ) : !nonMovingData || !nonMovingData.items || nonMovingData.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-16 text-center text-xs text-muted">
                          <FileCheck2 className="mx-auto mb-3 opacity-30 text-green" size={28} />
                          <p className="font-bold">No dormant items found</p>
                          <p className="text-[10px] mt-0.5">All stock items have transaction activity in the last {nonMovingDays} days.</p>
                        </td>
                      </tr>
                    ) : (
                      nonMovingData.items.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg2/40 transition-colors border-b border-glass-border/20">
                          <td className="p-3.5 pl-5 font-bold text-text">{row.medicineName || '—'}</td>
                          <td className="p-3.5 font-mono font-semibold text-muted">{row.batchNo || 'N/A'}</td>
                          <td className="p-3.5 font-mono text-text">{row.quantity ?? 0}</td>
                          <td className="p-3.5 font-mono text-text">₹{(row.mrp || 0).toFixed(2)}</td>
                          <td className="p-3.5 font-mono font-bold text-text">₹{(row.totalValue || 0).toFixed(2)}</td>
                          <td className="p-3.5 text-right pr-5 font-mono font-black text-amber-500">
                            {row.daysSinceLastTransaction === 999 ? (
                              <span className="text-[9px] bg-red/10 border border-red/20 text-red px-1.5 py-0.5 rounded-lg uppercase tracking-wider font-black">
                                Never Sold
                              </span>
                            ) : (
                              `${row.daysSinceLastTransaction} days`
                            )}
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

      </div>

    </div>
  );
};

export default Reports;
