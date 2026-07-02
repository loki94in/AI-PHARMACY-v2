import { useEffect, useState } from 'react';
import { Shield, Key, CheckCircle, XCircle, Clock } from 'lucide-react';
import { api } from '../../services/api';

interface LicenseStatus {
  status: 'active' | 'inactive' | 'trial';
  licenseKey?: string;
  expiryDate?: string;
  machineId?: string;
  daysRemaining?: number;
}

const statusConfig: Record<string, { label: string; color: string; bg: string; border: string; glow: string }> = {
  active: {
    label: 'Active',
    color: 'text-green',
    bg: 'bg-green/10',
    border: 'border-green/30',
    glow: 'rgba(16,185,129,0.18)',
  },
  inactive: {
    label: 'Inactive',
    color: 'text-red',
    bg: 'bg-red/10',
    border: 'border-red/30',
    glow: 'rgba(239,68,68,0.18)',
  },
  trial: {
    label: 'Trial',
    color: 'text-amber',
    bg: 'bg-amber/10',
    border: 'border-amber/30',
    glow: 'rgba(245,158,11,0.18)',
  },
};

const maskKey = (key?: string): string => {
  if (!key) return '————-————-————-————';
  const parts = key.split('-');
  if (parts.length < 2) return 'XXXX-XXXX-XXXX-' + key.slice(-4);
  return parts.map((p, i) => (i < parts.length - 1 ? 'X'.repeat(p.length) : p)).join('-');
};

const License = () => {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activateKey, setActivateKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchLicense = () => {
    setLoading(true);
    setError(null);
    api.getLicenseStatus()
      .then((data: LicenseStatus) => {
        setLicense(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to load license status');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLicense();
  }, []);

  const handleActivate = () => {
    const trimmed = activateKey.trim();
    if (!trimmed) {
      setActivateMsg({ type: 'error', text: 'Please enter a license key.' });
      return;
    }

    setActivating(true);
    setActivateMsg(null);
    api.activateLicense(trimmed)
      .then(() => {
        setActivateMsg({ type: 'success', text: 'License activated successfully!' });
        setActivateKey('');
        fetchLicense();
      })
      .catch((err: Error) => {
        setActivateMsg({ type: 'error', text: err.message || 'Activation failed. Please check your key.' });
      })
      .finally(() => setActivating(false));
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center fade-in">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <Shield size={40} className="text-muted/40" />
          <span className="text-muted">Loading license status...</span>
        </div>
      </div>
    );
  }

  if (error && !license) {
    return (
      <div className="h-full flex flex-col fade-in space-y-6">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight mb-1">License Management</h2>
          <p className="text-muted text-sm">Activate and manage your software license.</p>
        </div>
        <div className="glass-panel p-6 border-red/20 text-red flex items-center gap-3">
          <XCircle size={20} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const cfg = statusConfig[license?.status || 'inactive'] || statusConfig.inactive;
  const StatusIcon = license?.status === 'active' ? CheckCircle : license?.status === 'trial' ? Clock : XCircle;

  return (
    <div className="h-full flex flex-col fade-in space-y-6 overflow-y-auto pb-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight mb-1">License Management</h2>
        <p className="text-muted text-sm">Activate and manage your software license.</p>
      </div>

      {/* License Status Card */}
      <div className="max-w-2xl mx-auto w-full">
        <div className="glass-panel p-8 relative overflow-hidden">
          {/* Radial glow */}
          <div
            className="absolute top-0 right-0 w-64 h-64 translate-x-16 -translate-y-16 pointer-events-none"
            style={{ background: `radial-gradient(circle, ${cfg.glow} 0%, transparent 70%)` }}
          />
          <div
            className="absolute bottom-0 left-0 w-48 h-48 -translate-x-12 translate-y-12 pointer-events-none"
            style={{ background: `radial-gradient(circle, ${cfg.glow} 0%, transparent 70%)` }}
          />

          {/* Status Badge */}
          <div className="flex items-center justify-between mb-8 relative z-10">
            <h3 className="font-bold flex items-center gap-2 text-lg">
              <Shield size={22} className="text-primary" />
              License Status
            </h3>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
              <StatusIcon size={14} />
              {cfg.label}
            </span>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 relative z-10">
            {/* License Key */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Key size={12} />
                License Key
              </label>
              <div className="premium-input w-full font-mono text-sm tracking-widest select-all cursor-default">
                {maskKey(license?.licenseKey)}
              </div>
            </div>

            {/* Expiry Date */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={12} />
                Expiry Date
              </label>
              <div className="premium-input w-full text-sm">
                {license?.expiryDate
                  ? new Date(license.expiryDate).toLocaleDateString('en-IN', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '—'}
              </div>
            </div>

            {/* Machine ID */}
            <div className="space-y-2">
              <label htmlFor="machine-id" className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Shield size={12} />
                Machine ID
              </label>
              <input
                id="machine-id"
                type="text"
                readOnly
                value={license?.machineId || '—'}
                aria-label="Machine ID"
                className="premium-input w-full text-sm font-mono text-muted cursor-default"
              />
            </div>

            {/* Days Remaining */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={12} />
                Days Remaining
              </label>
              <div className={`premium-input w-full text-sm font-bold ${
                (license?.daysRemaining ?? 0) <= 7 ? 'text-red' :
                (license?.daysRemaining ?? 0) <= 30 ? 'text-amber' : 'text-green'
              }`}>
                {license?.daysRemaining !== undefined && license.daysRemaining !== null
                  ? `${license.daysRemaining} days`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activate License Panel */}
      <div className="max-w-2xl mx-auto w-full">
        <div className="glass-panel p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 translate-x-10 -translate-y-10 pointer-events-none bg-[radial-gradient(circle,rgba(59,130,246,0.12)_0%,transparent_70%)]" />

          <h3 className="font-bold flex items-center gap-2 text-lg mb-6 relative z-10">
            <Key size={20} className="text-primary" />
            Activate License
          </h3>

          <div className="space-y-4 relative z-10">
            <div className="space-y-2">
              <label htmlFor="license-key" className="text-xs font-bold text-muted uppercase tracking-wider">
                License Key
              </label>
              <input
                id="license-key"
                type="text"
                value={activateKey}
                onChange={e => setActivateKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleActivate()}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                aria-label="License Key"
                className="premium-input w-full font-mono tracking-wider"
                disabled={activating}
              />
            </div>

            <button
              onClick={handleActivate}
              disabled={activating}
              className="premium-btn bg-primary text-white shadow-[0_4px_14px_rgba(59,130,246,0.4)] hover:bg-blue-600 w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {activating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Activating...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle size={16} />
                  Activate
                </span>
              )}
            </button>

            {/* Status Message */}
            {activateMsg && (
              <div className={`flex items-center gap-2 text-sm font-semibold p-3 rounded-xl border ${
                activateMsg.type === 'success'
                  ? 'text-green bg-green/10 border-green/20'
                  : 'text-red bg-red/10 border-red/20'
              }`}>
                {activateMsg.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {activateMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default License;
