import { useState, useEffect } from 'react';

interface DateRange {
  from: string;
  to: string;
}

interface UsePersistedDateRangeOptions {
  storageKey: string;
  defaultFrom: string;
  defaultTo: string;
  minDate?: string;
  maxDate?: string;
  futurePresets?: boolean;
}

const getLocalDateString = (d: Date = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export function usePersistedDateRange({
  storageKey,
  defaultFrom,
  defaultTo,
  minDate = '2020-01-01',
  maxDate,
  futurePresets = false,
}: UsePersistedDateRangeOptions) {
  const today = maxDate || getLocalDateString(new Date());
  
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          from: parsed.from || defaultFrom,
          to: parsed.to || defaultTo,
        };
      }
    } catch {}
    return { from: defaultFrom, to: defaultTo };
  });

  const [manualToDate, setManualToDate] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(dateRange));
    }, 500);
    return () => clearTimeout(timer);
  }, [dateRange, storageKey]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          setDateRange(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [storageKey]);

  const handleFromChange = (val: string) => {
    if (val && val < minDate) val = minDate;
    if (!futurePresets && val && val > today) val = today;
    setDateRange(prev => ({ ...prev, from: val }));
  };

  const handleToChange = (val: string) => {
    if (val && val < minDate) val = minDate;
    if (!futurePresets && val && val > today) val = today;
    setManualToDate(true);
    setDateRange(prev => ({ ...prev, to: val }));
  };

  const clearFilters = () => {
    setDateRange({ from: defaultFrom, to: defaultTo });
    setManualToDate(false);
  };

  const setPreset = (days: number) => {
    const d = new Date();
    if (futurePresets) {
      const from = getLocalDateString(d);
      d.setDate(d.getDate() + days);
      const to = getLocalDateString(d);
      setDateRange({ from, to });
    } else {
      d.setDate(d.getDate() - days);
      const from = getLocalDateString(d);
      const to = today;
      setDateRange({ from, to });
    }
    setManualToDate(false);
  };

  return {
    dateRange,
    setDateRange,
    manualToDate,
    setManualToDate,
    handleFromChange,
    handleToChange,
    clearFilters,
    setPreset,
    minDate,
    maxDate: today,
    futurePresets,
    defaultFrom,
    defaultTo,
  };
}