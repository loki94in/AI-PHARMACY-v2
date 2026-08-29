import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Beaker, ShieldCheck, FileText, MessagesSquare, BrainCircuit } from 'lucide-react';
import CompositionPanel from './panels/CompositionPanel';
import ScheduleDrugsPanel from './panels/ScheduleDrugsPanel';
import CompliancePanel from './panels/CompliancePanel';
import WaRequestsPanel from './WaRequestsPanel';

const TABS = [
  { id: 'composition', label: 'Composition AI', icon: <Beaker size={15} /> },
  { id: 'schedules', label: 'Drug Schedules', icon: <ShieldCheck size={15} /> },
  { id: 'compliance', label: 'H1 Compliance', icon: <FileText size={15} /> },
  { id: 'wa', label: 'WA Requests', icon: <MessagesSquare size={15} /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

const normalizeTab = (raw: string | null): TabId =>
  (TABS.some((t) => t.id === raw) ? (raw as TabId) : 'composition');

const PharmaIntelligencePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTab(searchParams.get('tab'));

  const switchTab = (id: TabId) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === 'composition') next.delete('tab');
        else next.set('tab', id);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Shared header */}
      <div className="px-4 pt-3 pb-2 border-b border-glass-border">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <BrainCircuit size={22} />
          </div>
          <h1 className="text-2xl font-black text-text tracking-tight">Pharma Intelligence</h1>
          <span className="bg-violet-500/15 text-violet-400 border border-violet-500/30 text-xs font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            AI Engine
          </span>
        </div>
        <p className="text-sm text-muted mt-1">
          One command center for the app&apos;s AI machinery — composition enrichment, statutory drug-schedule
          classification, H1 compliance auditing and live WhatsApp medicine-request intelligence.
        </p>

        {/* Tab bar */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold border transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === t.id
                  ? 'bg-primary/15 border-primary/40 text-text'
                  : 'bg-bg2 border-glass-border text-muted hover:text-text'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active panel only — hidden tabs never fetch or print */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'composition' && <CompositionPanel />}
        {activeTab === 'schedules' && <ScheduleDrugsPanel />}
        {activeTab === 'compliance' && <CompliancePanel />}
        {activeTab === 'wa' && <WaRequestsPanel />}
      </div>
    </div>
  );
};

export default PharmaIntelligencePage;
