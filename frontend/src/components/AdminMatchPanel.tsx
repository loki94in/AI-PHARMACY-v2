import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  User,
  MessageSquare,
  Pill,
  CheckCircle,
  Store,
  Clock,
  XCircle,
  X,
  Edit2
} from 'lucide-react';
import { api } from '../services/api';

interface AdminMatchPanelProps {
  match: {
    customer: { id: number; name: string; phone: string } | null;
    isNewCustomer: boolean;
    medicineName: string;
    quantity: number;
    unit: string;
    localMatches: string[];
    catalogResults: { mapped: any[]; nonMapped: any[] } | null;
    confidence: number;
    isRepeat: boolean;
    messageBody: string;
    history?: any[];
  };
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

export default function AdminMatchPanel({ match, onClose, onSuccess }: AdminMatchPanelProps) {
  const {
    customer,
    medicineName: initialMedicineName,
    quantity: initialQuantity,
    unit,
    localMatches,
    catalogResults,
    confidence,
    isRepeat,
    messageBody,
    history
  } = match;

  const [destPhone, setDestPhone] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Correction states
  const [isEditing, setIsEditing] = useState(false);
  const [editedMedicineName, setEditedMedicineName] = useState(initialMedicineName);
  const [editedQuantity, setEditedQuantity] = useState(initialQuantity);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    api.getSettings().then(settings => {
      if (settings?.admin_whatsapp) {
        setDestPhone(settings.admin_whatsapp);
      }
    }).catch(console.error);
  }, []);

  // Update edit values if the match changes
  useEffect(() => {
    setEditedMedicineName(initialMedicineName);
    setEditedQuantity(initialQuantity);
    setIsEditing(false);
  }, [match]);

  const handleShare = async () => {
    let clean = destPhone.trim();
    if (!clean) return;

    if (!clean.endsWith('@c.us') && !clean.endsWith('@g.us') && !clean.endsWith('@broadcast') && !clean.endsWith('@lid')) {
      const digits = clean.replace(/\D/g, '');
      if (digits.length === 10) {
        clean = `91${digits}@c.us`;
      } else if (digits.length > 10) {
        clean = `${digits}@c.us`;
      }
    }

    setIsSharing(true);
    setShareStatus(null);
    
    const custName = customer?.name || 'New Customer';
    const custPhone = customer?.phone || 'Unknown';
    const messageText = `🔔 *Prescription Medicine Extracted*

👤 *Customer*: ${custName} (${custPhone})
📝 *Original Text*: "${messageBody || 'N/A'}"

💊 *Extracted Medicine*: ${editedMedicineName}
📦 *Quantity*: ${editedQuantity} ${unit}
⭐ *Match Confidence*: ${Math.round(confidence)}%`;

    try {
      await api.sendWhatsappMessage(clean, messageText);
      setShareStatus({ type: 'success', message: `Shared to ${clean}` });
    } catch (err: any) {
      console.error('Failed to share medicine details:', err);
      setShareStatus({ type: 'error', message: err?.response?.data?.error || 'Failed to send alert' });
    } finally {
      setIsSharing(false);
    }
  };

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      const patientName = customer?.name || 'WhatsApp Customer';
      const patientPhone = customer?.phone ? customer.phone.replace(/@c\.us$/, '') : '';

      const items = [{
        name: editedMedicineName,
        quantity: editedQuantity || 1,
        unit: unit
      }];

      await api.createStagedSale({
        patient_name: patientName,
        patient_phone: patientPhone,
        discount: 0,
        items
      });

      if (onSuccess) {
        onSuccess('Confirmed: Staged Phone Sale created successfully!');
      }
      onClose();
    } catch (err: any) {
      console.error('Failed to confirm and create staged sale:', err);
      alert('Error creating staged sale: ' + (err.message || 'Unknown error'));
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="space-y-4 text-left">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-bold text-text">Medicine Match</h2>
        </div>
        <button onClick={onClose} className="text-muted hover:text-text p-1 rounded hover:bg-bg3">
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Customer */}
      <div className="bg-bg3 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-muted" />
          <span className="text-xs font-medium text-muted uppercase tracking-wide">Customer</span>
        </div>
        {customer ? (
          <div className="text-sm text-text font-medium">{customer.name} <span className="text-muted">({customer.phone.replace(/@c\.us$/, '')})</span></div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full text-xs font-medium">🆕 New Customer</span>
          </div>
        )}
      </div>

      {/* Message context */}
      {messageBody && (
        <div className="bg-bg3 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-muted" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Message</span>
          </div>
          <p className="text-sm text-text italic font-medium">"{messageBody}"</p>
        </div>
      )}

      {/* Detected medicine */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Pill className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary uppercase tracking-wide">Detected Medicine</span>
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted font-bold block mb-1">MEDICINE NAME</label>
              <input
                type="text"
                value={editedMedicineName}
                onChange={(e) => setEditedMedicineName(e.target.value)}
                className="w-full bg-bg border border-glass-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted font-bold block mb-1">QUANTITY</label>
              <input
                type="number"
                value={editedQuantity}
                onChange={(e) => setEditedQuantity(Number(e.target.value))}
                className="w-24 bg-bg border border-glass-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 rounded bg-bg3 text-text text-xs hover:bg-bg2"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start">
              <div className="text-sm text-text font-bold">{editedMedicineName}</div>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 hover:bg-bg2 text-muted hover:text-text rounded transition-colors"
                title="Correct details"
              >
                <Edit2 size={12} />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted">
              {editedQuantity > 0 && <span>Qty: <strong className="text-text">{editedQuantity} {unit}</strong></span>}
              {confidence > 0 && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  confidence >= 90 ? 'bg-green-500/10 text-green-400' :
                  confidence >= 70 ? 'bg-amber-500/10 text-amber-400' :
                  'bg-red-500/10 text-red-400'
                }`}>
                  {Math.round(confidence)}% confidence
                </span>
              )}
              {isRepeat && <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-medium">Repeat Order</span>}
            </div>
          </>
        )}
      </div>

      {/* Local matches */}
      {localMatches?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Local DB Matches</span>
          </div>
          <div className="space-y-1">
            {localMatches.slice(0, 5).map((name: string, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-bg3 text-xs text-text">
                <Pill className="w-3 h-3 text-muted" />
                {name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mapped distributors */}
      {catalogResults && catalogResults.mapped && catalogResults.mapped.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Mapped Distributors ✅</span>
          </div>
          <div className="space-y-1">
            {catalogResults.mapped.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-bg3 text-xs">
                <div className="text-text">{p.name || p.distributor}</div>
                <div className="text-muted">
                  {p.mrp && <span>MRP ₹{p.mrp}</span>}
                  {p.distributorPrice && <span className="ml-2">PTR ₹{p.distributorPrice}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-mapped distributors */}
      {catalogResults && catalogResults.nonMapped && catalogResults.nonMapped.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Non-Mapped Distributors</span>
          </div>
          <div className="space-y-1">
            {catalogResults.nonMapped.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-bg3 text-xs opacity-80">
                <div className="text-text">{p.name || p.distributor}</div>
                <div className="text-muted">
                  {p.mrp && <span>MRP ₹{p.mrp}</span>}
                  {p.distributorPrice && <span className="ml-2">PTR ₹{p.distributorPrice}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer history */}
      {history && history.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted" />
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Purchase History</span>
          </div>
          <div className="space-y-1">
            {history.slice(0, 5).map((h: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded bg-bg3 text-xs">
                <span className="text-text">{h.medicine_name}</span>
                <span className="text-muted">{h.last_dispensed?.split('T')[0] || h.last_refill_date?.split('T')[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Share to WhatsApp Alert */}
      <div className="bg-bg3 border border-glass-border/40 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-muted uppercase tracking-wider block">
            Share Medicine Details
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Alert Phone number..."
            value={destPhone}
            onChange={(e) => setDestPhone(e.target.value)}
            className="bg-bg border border-glass-border rounded-lg px-2.5 py-1 text-xs text-text placeholder-muted focus:outline-none w-full"
          />
          <button
            type="button"
            onClick={handleShare}
            disabled={isSharing}
            className="bg-primary/20 hover:bg-primary/30 border border-primary/20 text-primary text-xs font-bold px-3 py-1 rounded-lg transition-colors shrink-0"
          >
            {isSharing ? 'Sharing...' : 'Share'}
          </button>
        </div>
        {shareStatus && (
          <p className={`text-[9px] font-bold mt-1 ${shareStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {shareStatus.message}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          onClick={handleConfirm}
          disabled={isConfirming}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-sm font-medium transition-colors"
        >
          <CheckCircle className="w-4 h-4" />
          {isConfirming ? 'Confirming...' : 'Confirm'}
        </button>
        <button
          onClick={() => setIsEditing(true)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-bg3 text-muted hover:text-text text-sm font-medium transition-colors"
        >
          ✏️ Correct
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg bg-bg3 text-muted hover:text-red-400 text-sm transition-colors"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
