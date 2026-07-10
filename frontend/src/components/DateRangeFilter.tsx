import { Calendar, X, RotateCcw } from 'lucide-react';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';

const getLocalDateString = (d: Date = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

interface DateRangeFilterProps {
  helper?: {
    dateRange: { from: string; to: string };
    handleFromChange: (val: string) => void;
    handleToChange: (val: string) => void;
    clearFilters: () => void;
    setPreset: (days: number) => void;
    manualToDate: boolean;
    setManualToDate: (val: boolean) => void;
    minDate: string;
    maxDate: string;
    futurePresets?: boolean;
    defaultFrom?: string;
    defaultTo?: string;
  };
  storageKey?: string;
  defaultFrom?: string;
  defaultTo?: string;
  label?: string;
  presets?: { label: string; days: number }[];
  className?: string;
  showPresets?: boolean;
  showInputs?: boolean;
  placeholder?: string;
}

export function DateRangeFilter({
  helper,
  storageKey = 'date-range',
  defaultFrom = '',
  defaultTo = '',
  label = 'Date Range',
  presets = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '180d', days: 180 },
  ],
  className = '',
  showPresets = true,
  showInputs = true,
  placeholder,
}: DateRangeFilterProps) {
  const internalHelper = usePersistedDateRange({ storageKey, defaultFrom, defaultTo });
  
  const h = helper || internalHelper;
  const currentValue = h.dateRange;
  
  const dFrom = h.defaultFrom !== undefined ? h.defaultFrom : defaultFrom;
  const dTo = h.defaultTo !== undefined ? h.defaultTo : defaultTo;
  const hasFilters = currentValue.from !== dFrom || currentValue.to !== dTo;

  const isPresetActive = (days: number) => {
    const d = new Date();
    let expectedFrom = '';
    let expectedTo = '';
    const isFuture = h.futurePresets || false;
    
    if (isFuture) {
      expectedFrom = getLocalDateString(d);
      d.setDate(d.getDate() + days);
      expectedTo = getLocalDateString(d);
    } else {
      d.setDate(d.getDate() - days);
      expectedFrom = getLocalDateString(d);
      expectedTo = h.maxDate || getLocalDateString(new Date());
    }
    
    return currentValue.from === expectedFrom && currentValue.to === expectedTo;
  };

  const isAllActive = !hasFilters;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">{label}</label>
      )}
      
      {showPresets && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted hidden sm:inline">Quick:</span>
          {presets.map(p => {
            const active = isPresetActive(p.days);
            return (
              <button
                key={p.days}
                type="button"
                onClick={() => {
                  h.setPreset(p.days);
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border ${
                  active
                    ? 'bg-primary border-primary text-white shadow-md shadow-primary/10'
                    : 'bg-white/5 border-glass-border/60 text-muted hover:text-text hover:bg-white/10'
                }`}
                title={`Last ${p.days} days`}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => h.clearFilters()}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border ${
              isAllActive
                ? 'bg-primary border-primary text-white shadow-md shadow-primary/10'
                : 'bg-white/5 border-glass-border/60 text-muted hover:text-red hover:bg-red/10'
            }`}
            title="Clear filters"
          >
            <X size={10} className="inline mr-0.5" /> All
          </button>
        </div>
      )}

      {showInputs && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted w-10">From</span>
            <input
              type="date"
              value={currentValue.from}
              onChange={e => h.handleFromChange(e.target.value)}
              min={h.minDate}
              max={h.maxDate}
              placeholder={placeholder}
              className="px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50 w-32"
            />
          </div>
          
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted w-6">To</span>
            <input
              type="date"
              value={currentValue.to}
              onChange={e => h.handleToChange(e.target.value)}
              min={h.minDate}
              max={h.maxDate}
              disabled={!h.manualToDate}
              className="px-2 py-1.5 bg-bg3 border border-glass-border rounded-lg text-xs text-text focus:outline-none focus:border-primary/50 disabled:opacity-50 w-32"
            />
            <label className="flex items-center gap-1 cursor-pointer select-none text-[9px] text-muted hover:text-text">
              <input
                type="checkbox"
                checked={h.manualToDate}
                onChange={e => h.setManualToDate(e.target.checked)}
                className="rounded border-glass-border text-primary focus:ring-primary/20 bg-bg w-3 h-3"
              />
              <span>Edit</span>
            </label>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={() => h.clearFilters()}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red hover:text-red/80 bg-red/10 border border-red/20 hover:bg-red/20 transition-all"
            >
              <X size={10} className="inline mr-0.5" /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}