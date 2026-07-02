import { useState } from 'react';
import { useDeferredEffect } from '../../hooks/useDeferredEffect';
import { IndianRupee, PackageOpen, ListTodo, Server, ArrowUpRight, AlertTriangle, Clock, CheckCircle, Activity, MessageCircle, Mail, Send } from 'lucide-react';
import { api } from '../../services/api';
import type { DashboardStats } from '../../services/api';

const Dashboard = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState('');

  useDeferredEffect(() => {
    setDateStr(new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    
    api.getDashboard()
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load dashboard data');
        setLoading(false);
      });
  }, []);

  const handleDismissAlert = async (id: number) => {
    try {
      await api.dismissDashboardAlert(id);
      setStats(prev => {
        if (!prev) return null;
        const updatedAlerts = prev.alerts ? prev.alerts.filter(a => a.id !== id) : [];
        return {
          ...prev,
          pendingTasks: Math.max(0, prev.pendingTasks - 1),
          alerts: updatedAlerts
        };
      });
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  };

  if (loading) {
    return <div className="animate-pulse flex space-x-4">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="text-red p-4 glass-panel border-red/20">{error}</div>;
  }

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight mb-1">Welcome back, Admin 👋</h2>
          <p className="text-muted">Here's what's happening at your pharmacy today.</p>
        </div>
        <div className="text-sm font-semibold text-sky bg-sky-bg px-4 py-2 rounded-full border border-sky/20">
          Today: {dateStr}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Sales Card */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(16,185,129,0.15)_0%,transparent_70%)] translate-x-8 -translate-y-8" />
          <IndianRupee className="absolute right-6 top-6 text-muted/30" size={28} />
          
          <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">Today's Sales</div>
          <div className="text-3xl font-extrabold text-green mb-3">
            ₹{Number(stats?.todaySales || 0).toFixed(2)}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-green">
            <ArrowUpRight size={14} />
            <span>+12% vs yesterday</span>
          </div>
        </div>

        {/* Low Stock */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(239,68,68,0.15)_0%,transparent_70%)] translate-x-8 -translate-y-8" />
          <PackageOpen className="absolute right-6 top-6 text-muted/30" size={28} />
          
          <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">Low Stock Items</div>
          <div className="text-3xl font-extrabold text-red mb-3">
            {stats?.lowStock || 0}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-red">
            <AlertTriangle size={14} />
            <span>Needs attention</span>
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(245,158,11,0.15)_0%,transparent_70%)] translate-x-8 -translate-y-8" />
          <ListTodo className="absolute right-6 top-6 text-muted/30" size={28} />
          
          <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">Pending Tasks</div>
          <div className="text-3xl font-extrabold text-amber mb-3">
            {stats?.pendingTasks || 0}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Clock size={14} />
            <span>3 due today</span>
          </div>
        </div>

        {/* System Status */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(14,165,233,0.15)_0%,transparent_70%)] translate-x-8 -translate-y-8" />
          <Server className="absolute right-6 top-6 text-muted/30" size={28} />
          
          <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">System Status</div>
          <div className="text-2xl font-bold text-sky mb-3 mt-1 flex items-center gap-2">
            Connected <CheckCircle size={16} />
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            All services operational
          </div>
        </div>
      </div>

      {/* Fallback System Alerts Panel */}
      {stats?.alerts && stats.alerts.length > 0 && (
        <div className="glass-panel border-amber-500/20 bg-amber-500/5 overflow-hidden">
          <div className="p-5 border-b border-amber-500/20 flex justify-between items-center bg-amber-500/10">
            <h3 className="font-bold flex items-center gap-2 text-amber-500">
              <AlertTriangle size={18} className="animate-pulse" /> 
              System Alerts & Missed Automations
            </h3>
            <span className="text-[10px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-500 px-2 py-0.5 rounded-full uppercase">
              Action Required
            </span>
          </div>
          <div className="divide-y divide-glass-border/30">
            {stats.alerts.slice(0, 50).map(alert => (
              <div key={alert.id} className="p-4 flex items-center justify-between gap-4 hover:bg-white/5 transition-all">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-text">{alert.description}</p>
                  <span className="text-[9px] text-muted font-mono">
                    Logged: {new Date(alert.created_at).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => handleDismissAlert(alert.id)}
                  className="px-3 py-1 bg-white/5 hover:bg-white/10 text-muted hover:text-text text-[10px] font-bold border border-glass-border rounded-lg transition-all"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Omnichannel Communications Feed */}
      <div className="glass-panel border-sky/20 bg-sky/5 overflow-hidden mb-6">
        <div className="p-5 border-b border-sky/20 flex justify-between items-center bg-sky/10">
          <h3 className="font-bold flex items-center gap-2 text-sky">
            <MessageCircle size={18} /> 
            Live Communications Feed
          </h3>
          <span className="text-[10px] font-bold bg-sky/20 border border-sky/30 text-sky px-2 py-0.5 rounded-full uppercase">
            Real-time
          </span>
        </div>
        <div className="divide-y divide-glass-border/30">
          <div className="p-8 text-center text-sm text-muted">
            No recent communications
          </div>
        </div>
      </div>

      {/* Recent Sales Table Placeholder (Would be populated by another API call) */}
      <div className="glass-panel overflow-hidden">
        <div className="p-5 border-b border-glass-border flex justify-between items-center bg-white/5">
          <h3 className="font-bold flex items-center gap-2">
            <Activity size={18} className="text-amber" /> 
            Recent Sales Activity
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Invoice</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Customer</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Total</th>
                <th className="p-4 text-xs font-bold text-muted uppercase tracking-wider border-b border-glass-border bg-black/20">Payment</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted">
                  Sales history implementation pending...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
