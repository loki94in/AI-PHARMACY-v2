import React from 'react';
import { Link } from 'react-router-dom';
import { IndianRupee, PackageOpen, ListTodo, Server, ArrowUpRight, AlertTriangle, Clock, CheckCircle, Activity, MessageCircle, Mail, Truck, Layers, ClipboardList, ShoppingBag, ShoppingCart, PlusCircle, Search, Users, ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import type { DashboardStats } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';

let cachedDashboardStats: DashboardStats | null = null;

const Dashboard = () => {
  const queryClient = useQueryClient();
  const { data: stats = cachedDashboardStats, isLoading: loading, error } = useApiQuery<DashboardStats>(
    'dashboard',
    async () => {
      const res = await api.getDashboard();
      if (res) cachedDashboardStats = res;
      return res;
    },
    {
      initialData: cachedDashboardStats || undefined,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    }
  );

  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const handleDismissAlert = async (id: number) => {
    try {
      await api.dismissDashboardAlert(id);
      queryClient.setQueryData<DashboardStats>(['dashboard'], prev => {
        if (!prev) return prev;
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
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-8">
          <div className="space-y-2">
            <div className="h-8 w-64 bg-bg3 rounded-lg" />
            <div className="h-4 w-48 bg-bg3 rounded" />
          </div>
          <div className="h-9 w-40 bg-bg3 rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="glass-panel p-6 space-y-3">
              <div className="h-3 w-24 bg-bg3 rounded" />
              <div className="h-8 w-32 bg-bg3 rounded" />
              <div className="h-3 w-20 bg-bg3 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-red p-4 glass-panel border-red/20">{(error as Error).message || 'Failed to load dashboard data'}</div>;
  }

  const hasRecentSales = stats?.recentSales && stats.recentSales.length > 0;
  const hasRecentComms = stats?.recentCommunications && stats.recentCommunications.length > 0;

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-1 text-text">Welcome back, Admin</h2>
          <p className="text-muted text-sm sm:text-base">Here's what's happening at your pharmacy today.</p>
        </div>
        <div className="text-sm font-semibold text-sky bg-sky/10 px-4 py-2 rounded-full border border-sky/20 self-start sm:self-auto">
          Today: {dateStr}
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="glass-panel p-4 mb-6">
        <div className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Quick Actions</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Link to="/pos" className="flex items-center gap-2.5 p-3 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all font-semibold text-sm">
            <ShoppingCart size={18} />
            <span>New POS Bill</span>
          </Link>
          <Link to="/purchases" className="flex items-center gap-2.5 p-3 rounded-xl bg-sky/10 border border-sky/20 text-sky hover:bg-sky/20 transition-all font-semibold text-sm">
            <PlusCircle size={18} />
            <span>Add Purchase</span>
          </Link>
          <Link to="/inventory" className="flex items-center gap-2.5 p-3 rounded-xl bg-amber/10 border border-amber/20 text-amber hover:bg-amber/20 transition-all font-semibold text-sm">
            <Search size={18} />
            <span>Inventory</span>
          </Link>
          <Link to="/crm?tab=special_orders" className="flex items-center gap-2.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-all font-semibold text-sm">
            <ClipboardList size={18} />
            <span>Special Orders</span>
          </Link>
          <Link to="/crm" className="flex items-center gap-2.5 p-3 rounded-xl bg-bg3 border border-border text-text hover:bg-bg2 transition-all font-semibold text-sm">
            <Users size={18} />
            <span>CRM & Refills</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        {/* Sales Card */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(16,185,129,0.15)_0%,transparent_70%)] translate-x-8 -translate-y-8" />
          <IndianRupee className="absolute right-6 top-6 text-muted/30" size={28} />
          
          <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">Today's Sales</div>
          <div className="text-3xl font-extrabold text-green mb-3">
            ₹{Number(stats?.todaySales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-green">
            <ArrowUpRight size={14} />
            <span>Live updated</span>
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
            <span>Quantity &lt; 5 units</span>
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(245,158,11,0.15)_0%,transparent_70%)] translate-x-8 -translate-y-8" />
          <ListTodo className="absolute right-6 top-6 text-muted/30" size={28} />
          
          <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">Pending Alerts</div>
          <div className="text-3xl font-extrabold text-amber mb-3">
            {stats?.pendingTasks || 0}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Clock size={14} />
            <span>System notifications</span>
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

      {/* Operational Highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="glass-panel p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Layers size={18} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-muted uppercase tracking-wider">Storage Racks</div>
            <div className="text-lg font-bold text-text">{stats?.storageLocations || 5} active</div>
          </div>
        </div>

        <div className="glass-panel p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber/10 border border-amber/20 text-amber">
            <ClipboardList size={18} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-muted uppercase tracking-wider">Special Orders</div>
            <div className="text-lg font-bold text-amber">{stats?.pendingSpecialOrders || 0} pending</div>
          </div>
        </div>

        <div className="glass-panel p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky/10 border border-sky/20 text-sky">
            <Truck size={18} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-muted uppercase tracking-wider">Delivery Boys</div>
            <div className="text-lg font-bold text-sky">{stats?.activeDeliveryBoys || 0} staff</div>
          </div>
        </div>

        <div className="glass-panel p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <ShoppingBag size={18} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-muted uppercase tracking-wider">Today Purchases</div>
            <div className="text-lg font-bold text-text">₹{Number(stats?.todayPurchases || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
          </div>
        </div>
      </div>

      {/* System Alerts & Missed Automations Panel */}
      {stats?.alerts && stats.alerts.length > 0 && (
        <div className="glass-panel border-amber-500/20 bg-amber-500/5 overflow-hidden mb-6">
          <div className="p-5 border-b border-amber-500/20 flex justify-between items-center bg-amber-500/10">
            <h3 className="font-bold flex items-center gap-2 text-amber-500">
              <AlertTriangle size={18} className="animate-pulse" /> 
              System Alerts & Action Items
            </h3>
            <span className="text-[10px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-500 px-2 py-0.5 rounded-full uppercase">
              Action Required ({stats.alerts.length})
            </span>
          </div>
          <div className="divide-y divide-border">
            {stats.alerts.slice(0, 10).map(alert => (
              <div key={alert.id} className="p-4 flex items-center justify-between gap-4 hover:bg-bg3/50 transition-all">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-text">{alert.description}</p>
                  <span className="text-[10px] text-muted font-mono">
                    Logged: {new Date(alert.created_at).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => handleDismissAlert(alert.id)}
                  aria-label={`Dismiss alert: ${alert.description}`}
                  className="px-3 py-1.5 min-h-8 bg-bg2 hover:bg-bg3 text-muted hover:text-text text-[11px] font-bold border border-border rounded-lg transition-all cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Sales Activity Section */}
      <div className="glass-panel overflow-hidden mb-6">
        <div className="p-5 border-b border-border flex justify-between items-center bg-bg2/40">
          <h3 className="font-bold flex items-center gap-2 text-text">
            <Activity size={18} className="text-amber" /> 
            Recent Sales Activity
          </h3>
          <Link to="/sells" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
            View All Sales <ArrowRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          {hasRecentSales ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-bg3/50 text-muted text-xs uppercase font-bold tracking-wider">
                  <th className="p-4">Invoice No</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Total Amount</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {stats.recentSales!.map((sale) => (
                  <tr key={sale.id} className="hover:bg-bg3/30 transition-all">
                    <td className="p-4 font-mono font-bold text-primary">{sale.invoice_no}</td>
                    <td className="p-4 font-medium text-text">{sale.customer_name || 'Walk-in Customer'}</td>
                    <td className="p-4 font-bold text-green">₹{Number(sale.total_amount || 0).toFixed(2)}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-bg3 text-text border border-border">
                        {sale.payment_medium || 'CASH'} • {sale.payment_status || 'PAID'}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-muted font-mono">
                      {sale.date ? new Date(sale.date).toLocaleString() : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center space-y-3">
              <p className="text-muted text-sm">No recent sales recorded yet today.</p>
              <Link to="/pos" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold shadow hover:opacity-90 transition-all">
                <ShoppingCart size={16} /> Create First POS Sale
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Communications & Ingestion Feed */}
      <div className="glass-panel border-sky/20 bg-sky/5 overflow-hidden">
        <div className="p-5 border-b border-sky/20 flex justify-between items-center bg-sky/10">
          <h3 className="font-bold flex items-center gap-2 text-sky">
            <MessageCircle size={18} /> 
            Recent Communications & Ingestion
          </h3>
          <Link to="/mail" className="text-xs font-semibold text-sky hover:underline flex items-center gap-1">
            Open Mail <ArrowRight size={14} />
          </Link>
        </div>
        <div>
          {hasRecentComms ? (
            <div className="divide-y divide-border">
              {stats.recentCommunications!.map((comm, idx) => (
                <div key={idx} className="p-4 flex items-center justify-between gap-4 hover:bg-bg3/50 transition-all">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-sky/10 text-sky border border-sky/20">
                      <Mail size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text">{comm.title || 'Email Ingestion'}</p>
                      <p className="text-xs text-muted">{comm.recipient_or_sender || 'System'}</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted font-mono">
                    {comm.created_at ? new Date(comm.created_at).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted space-y-2">
              <p>No recent email or message logs found.</p>
              <Link to="/mail" className="inline-flex items-center gap-1.5 text-xs text-sky font-semibold hover:underline">
                <Mail size={14} /> Check Inbox
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
