import { useState, useEffect, useMemo } from 'react';
import { getLocalDateString, getTodayString } from '../utils/date';

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

export function usePersistedDateRange({
  storageKey,
  defaultFrom,
  defaultTo,
  minDate = '2020-01-01',
  maxDate,
  futurePresets = false,
}: UsePersistedDateRangeOptions) {
  const today = maxDate || getLocalDateString(new Date());

  // Pure helper to restore the range and manualTo state
  const restored = useMemo(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        
        // 1. futurePresets === true (Expiry page) -> restore verbatim, never roll.
        if (futurePresets) {
          return {
            dateRange: { from: parsed.from ?? defaultFrom, to: parsed.to ?? defaultTo },
            manualTo: !!parsed.manualTo,
          };
        }

        // 2. parsed.to === '' (explicit All Dates — Sells/Inventory/CustomerReturnHistory) -> keep ''
        if (parsed.to === '') {
          return {
            dateRange: { from: parsed.from ?? defaultFrom, to: '' },
            manualTo: !!parsed.manualTo,
          };
        }

        // 3. parsed.isDefault === true -> discard stored values, return fresh defaults
        if (parsed.isDefault === true) {
          return {
            dateRange: { from: defaultFrom, to: defaultTo },
            manualTo: false,
          };
        }

        // 4. parsed.manualTo === true -> restore verbatim (user pinned a historical upper bound)
        if (parsed.manualTo === true) {
          return {
            dateRange: { from: parsed.from ?? defaultFrom, to: parsed.to ?? defaultTo },
            manualTo: true,
          };
        }

        // 5. Clock-skew guard: parsed.savedOn > today -> restore verbatim
        if (parsed.savedOn && parsed.savedOn > today) {
          return {
            dateRange: { from: parsed.from ?? defaultFrom, to: parsed.to ?? defaultTo },
            manualTo: !!parsed.manualTo,
          };
        }

        // 6. If parsed.to >= parsed.savedOn (window reached "today" when saved) and parsed.to < today -> roll to = today
        if (parsed.savedOn && parsed.to && parsed.to >= parsed.savedOn && parsed.to < today) {
          return {
            dateRange: { from: parsed.from ?? defaultFrom, to: today },
            manualTo: false,
          };
        }

        // 7. Legacy migration (no savedOn field) -> roll if to < today
        if (!parsed.savedOn && parsed.to && parsed.to < today) {
          return {
            dateRange: { from: parsed.from ?? defaultFrom, to: today },
            manualTo: false,
          };
        }

        return {
          dateRange: { from: parsed.from ?? defaultFrom, to: parsed.to ?? defaultTo },
          manualTo: !!parsed.manualTo,
        };
      }
    } catch {}
    return {
      dateRange: { from: defaultFrom, to: defaultTo },
      manualTo: false,
    };
  }, [storageKey, defaultFrom, defaultTo, futurePresets, today]);

  const [dateRange, setDateRange] = useState<DateRange>(restored.dateRange);
  const [manualToDate, setManualToDate] = useState<boolean>(restored.manualTo);

  // Debounced save effect
  useEffect(() => {
    const timer = setTimeout(() => {
      const payload = {
        from: dateRange.from,
        to: dateRange.to,
        savedOn: getLocalDateString(new Date()),
        manualTo: manualToDate,
        isDefault: dateRange.from === defaultFrom && dateRange.to === defaultTo,
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    }, 500);
    return () => clearTimeout(timer);
  }, [dateRange, manualToDate, storageKey, defaultFrom, defaultTo]);

  // Sync state across multiple open tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setDateRange({ from: parsed.from ?? defaultFrom, to: parsed.to ?? defaultTo });
          setManualToDate(!!parsed.manualTo);
        } catch {}
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [storageKey, defaultFrom, defaultTo]);

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