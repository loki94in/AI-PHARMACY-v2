import { useState, useEffect, useRef } from 'react';
import { BarChart3, TrendingUp, Download, IndianRupee, ShoppingBag, Package, FileText, Info } from 'lucide-react';
import { api } from '../../services/api';

const getTodayString = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getNDaysAgoString = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const Reports = () => {
  const [fromDate, setFromDate] = useState(getNDaysAgoString(15));
  const [toDate, setToDate] = useState(getTodayString());
  const [manualToDate, setManualToDate] = useState(false);

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
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'purchases' | 'expiry'>('sales');
  const [stats, setStats] = useState({ totalSales: 0, totalPurchases: 0, profitMargin: 0, itemsSold: 0 });
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [hasGenerated, setHasGenerated] = useState(false);
  const isMounted = useRef(false);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const [summaryData, tableData] = await Promise.all([
        api.getReportsSummary({ fromDate, toDate }),
        api.getReportsData({ type: activeTab, fromDate, toDate })
      ]);
      setStats(summaryData);
      setRecords(tableData);
      setHasGenerated(true);
    } catch (err) {
      console.error('Error fetching report data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (hasGenerated) {
      fetchReportData();
    }
  }, [activeTab]);

  const handleExport = async (format: 'pdf' | 'excel') => {
    try {
      let blob;
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

  const statsCards = [
    {
      label: 'Total Revenue',
      value: `₹${(stats.totalSales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: IndianRupee,
      color: 'green',
      gradient: 'rgba(16,185,129,0.15)',
    },
    {
      label: 'Total Purchases',
      value: `₹${(stats.totalPurchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: ShoppingBag,
      color: 'sky',
      gradient: 'rgba(14,165,233,0.15)',
    },
    {
      label: 'Profit Margin',
      value: `${stats.profitMargin || 0}%`,
      icon: TrendingUp,
      color: 'amber',
      gradient: 'rgba(245,158,11,0.15)',
    },
    {
      label: 'Items Sold',
      value: (stats.itemsSold || 0).toLocaleString('en-IN'),
      icon: Package,
      color: 'primary',
      gradient: 'rgba(59,130,246,0.15)',
    },
  ];

  const colorMap: Record<string, string> = {
    green: 'text-green',
    sky: 'text-sky',
    amber: 'text-amber',
    primary: 'text-primary',
  };

  const tabs = [
    { id: 'sales', label: 'Sales Report', icon: FileText, color: 'text-green' },
    { id: 'inventory', label: 'Inventory Report', icon: Package, color: 'text-sky' },
    { id: 'purchases', label: 'Purchase Report', icon: ShoppingBag, color: 'text-amber' },
    { id: 'expiry', label: 'Expiry Report', icon: BarChart3, color: 'text-red' },
  ] as const;

  return (
    <div className="h-full flex flex-col fade-in gap-4 min-h-0 overflow-hidden text-text bg-bg">
      {/* Date Controls & Action Row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-bg2 border border-border p-3 rounded-xl flex-shrink-0">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-primary shrink-0" />
          <span className="text-xs text-muted font-medium">Live reporting engine active. Filter by custom dates.</span>
        </div>
        <div className="flex gap-2 items-center flex-wrap w-full sm:w-auto justify-end">
          <div className="flex items-center gap-1.5 text-xs text-muted font-semibold">
            <span>From</span>
            <input
              type="date"
              min="2020-01-01"
              max={getTodayString()}
              className="bg-bg3 border border-glass-border rounded-lg px-2 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none"
              value={fromDate}
              onChange={(e) => handleFromDateChange(e.target.value)}
              aria-label="From Date"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted font-semibold">
            <span>To</span>
            <input
              type="date"
              min="2020-01-01"
              max={getTodayString()}
              disabled={!manualToDate}
              className="bg-bg3 border border-glass-border rounded-lg px-2 py-1 text-text text-xs focus:ring-1 focus:ring-primary focus:outline-none disabled:opacity-50"
              value={toDate}
              onChange={(e) => handleToDateChange(e.target.value)}
              aria-label="To Date"
            />
            <label className="text-[10px] text-muted flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={manualToDate}
                onChange={e => setManualToDate(e.target.checked)}
                className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg3"
              />
              Edit
            </label>
          </div>
          <button
            onClick={fetchReportData}
            className="bg-green hover:bg-green/95 text-white font-semibold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
            title="Generate Report"
          >
            <BarChart3 size={14} />
            <span>Generate</span>
          </button>
        </div>
      </div>

      {/* Stats Grid - Compact Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">
        {statsCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-bg2 border border-border rounded-xl p-4 relative overflow-hidden group">
              <div
                className="absolute top-0 right-0 w-24 h-24 translate-x-6 -translate-y-6 pointer-events-none"
                style={{ background: `radial-gradient(circle, ${card.gradient} 0%, transparent 70%)` }}
              />
              <Icon className="absolute right-4 top-4 text-muted/20" size={24} />
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">{card.label}</div>
              <div className={`text-2xl font-black ${colorMap[card.color]} mb-1`}>
                {card.value}
              </div>
              <div className="text-[9px] text-muted font-medium">
                {fromDate || toDate ? 'Filtered' : 'All-time'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Workspace: Split tabs left, selected table right */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        
        {/* Left Tabs Selection Sidebar */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-2 bg-bg2 border border-border rounded-xl p-3 overflow-y-auto scrollbar-thin">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted px-2 mb-1">Select Report</h3>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all text-left ${
                  isActive
                    ? 'bg-primary/10 border-primary text-text font-bold'
                    : 'bg-bg3/30 border-glass-border text-muted hover:text-text hover:bg-bg3'
                }`}
              >
                <Icon size={16} className={isActive ? tab.color : 'text-muted'} />
                <span className="flex-1 truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Active Table Panel */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-bg2 border border-border rounded-xl">
          {activeTab === 'sales' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border flex justify-between items-center bg-bg3/30 flex-shrink-0">
                <h3 className="font-bold text-sm flex items-center gap-2 text-text">
                  <FileText size={18} className="text-green" />
                  <span>Sales Records</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to PDF"
                  >
                    <FileText size={14} />
                    <span>Export PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to Excel"
                  >
                    <Download size={14} />
                    <span>Export Excel</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border shadow-sm">
                    <tr className="text-muted">
                      <th className="p-3 font-semibold border-b border-glass-border">Date</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Invoice</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">Loading records...</td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">
                          {!hasGenerated ? 'Select parameters and click "Generate" to load report data' : 'No sales records found'}
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                          <td className="p-3">{row.date ? row.date.substring(0, 10) : '—'}</td>
                          <td className="p-3 font-semibold">{row.invoice_no || '—'}</td>
                          <td className="p-3">₹{(row.total_amount || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border flex justify-between items-center bg-bg3/30 flex-shrink-0">
                <h3 className="font-bold text-sm flex items-center gap-2 text-text">
                  <Package size={18} className="text-sky" />
                  <span>Inventory Status</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to PDF"
                  >
                    <FileText size={14} />
                    <span>Export PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to Excel"
                  >
                    <Download size={14} />
                    <span>Export Excel</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border shadow-sm">
                    <tr className="text-muted">
                      <th className="p-3 font-semibold border-b border-glass-border">Medicine</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Stock</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">Loading records...</td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">
                          {!hasGenerated ? 'Select parameters and click "Generate" to load report data' : 'No inventory records found'}
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                          <td className="p-3 font-semibold">{row.medicine_name || '—'}</td>
                          <td className="p-3">{row.stock ?? 0}</td>
                          <td className="p-3">₹{(row.value || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'purchases' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border flex justify-between items-center bg-bg3/30 flex-shrink-0">
                <h3 className="font-bold text-sm flex items-center gap-2 text-text">
                  <ShoppingBag size={18} className="text-amber" />
                  <span>Purchase Logs</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to PDF"
                  >
                    <FileText size={14} />
                    <span>Export PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to Excel"
                  >
                    <Download size={14} />
                    <span>Export Excel</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border shadow-sm">
                    <tr className="text-muted">
                      <th className="p-3 font-semibold border-b border-glass-border">Date</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Invoice / Bill No</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Distributor</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center text-xs text-muted">Loading records...</td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                        <td colSpan={4} className="p-12 text-center text-xs text-muted">
                          {!hasGenerated ? 'Select parameters and click "Generate" to load report data' : 'No purchase records found'}
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                          <td className="p-3">{row.date ? row.date.substring(0, 10) : '—'}</td>
                          <td className="p-3 font-semibold">{row.invoice_no || '—'}</td>
                          <td className="p-3">{row.distributor || '—'}</td>
                          <td className="p-3">₹{(row.total_amount || 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'expiry' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="p-4 border-b border-glass-border flex justify-between items-center bg-bg3/30 flex-shrink-0">
                <h3 className="font-bold text-sm flex items-center gap-2 text-text">
                  <BarChart3 size={18} className="text-red" />
                  <span>Expiry Warning List</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to PDF"
                  >
                    <FileText size={14} />
                    <span>Export PDF</span>
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="px-3 py-1.5 bg-green/10 hover:bg-green/20 border border-green/20 text-green rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95"
                    title="Export to Excel"
                  >
                    <Download size={14} />
                    <span>Export Excel</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-bg2 border-b border-glass-border shadow-sm">
                    <tr className="text-muted">
                      <th className="p-3 font-semibold border-b border-glass-border">Medicine</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Batch</th>
                      <th className="p-3 font-semibold border-b border-glass-border">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">Loading records...</td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                        <td colSpan={3} className="p-12 text-center text-xs text-muted">
                          {!hasGenerated ? 'Select parameters and click "Generate" to load report data' : 'No expiry records found'}
                        </td>
                      </tr>
                    ) : (
                      records.map((row, idx) => (
                        <tr key={idx} className="hover:bg-bg3/20 transition-colors border-b border-glass-border/30">
                          <td className="p-3 font-semibold">{row.medicine_name || '—'}</td>
                          <td className="p-3">{row.batch_no || '—'}</td>
                          <td className="p-3">{row.expiry_date || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
};

export default Reports;
