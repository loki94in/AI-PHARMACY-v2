import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar as CalendarIcon, Clock, Pause, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, apiClient } from '../services/api';
import { toastEvent, whatsappQueueEvent } from '../services/events';

// Indian Public & National Holidays (2026 reference)
const INDIAN_HOLIDAYS_2026: Record<string, string> = {
  '2026-01-01': 'New Year',
  '2026-01-26': 'Republic Day',
  '2026-03-04': 'Mahashivratri',
  '2026-03-14': 'Holi',
  '2026-03-20': 'Id-ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Ambedkar Jayanti',
  '2026-05-01': 'May Day',
  '2026-05-27': 'Bakrid',
  '2026-08-15': 'Independence Day',
  '2026-08-26': 'Janmashtami',
  '2026-09-16': 'Milad-un-Nabi',
  '2026-10-02': 'Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-08': 'Diwali',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
};

interface DateCardItem {
  dateStr: string; // YYYY-MM-DD
  dayName: string; // Sun, Mon, etc.
  dateNum: number;
  monthName: string;
  isToday: boolean;
  isSunday: boolean;
  holidayName?: string;
  isPaused: boolean;
}

export const PharmarackCartCalendar: React.FC = () => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Paused dates set (stored in localStorage & synced to backend settings)
  const [pausedDates, setPausedDates] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('pharmarack_paused_dispatch_dates');
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    return [];
  });

  // Timer Pacing state (seconds)
  const [timerSec, setTimerSec] = useState<number>(10);

  // Fetch current pacing and schedule settings
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.getWhatsAppQueueStatus();
        if (mounted && data?.currentPacingMinMs) {
          setTimerSec(Math.round(data.currentPacingMinMs / 1000));
        }
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, []);

  // Save paused dates to localStorage & backend
  const updatePausedDates = (newDates: string[]) => {
    setPausedDates(newDates);
    try {
      localStorage.setItem('pharmarack_paused_dispatch_dates', JSON.stringify(newDates));
    } catch (_) {}

    apiClient.post('/settings/save', {
      pharmarack_paused_dispatch_dates: JSON.stringify(newDates)
    }).catch(() => {});
  };

  const togglePauseDate = (dateStr: string) => {
    if (pausedDates.includes(dateStr)) {
      const updated = pausedDates.filter(d => d !== dateStr);
      updatePausedDates(updated);
      toastEvent.trigger(`Resumed auto-dispatch for ${dateStr}`, 'info');
    } else {
      const updated = [...pausedDates, dateStr];
      updatePausedDates(updated);
      toastEvent.trigger(`Paused auto-dispatch for ${dateStr}`, 'info');
    }
  };

  const handleTimerChange = async (newSec: number) => {
    if (newSec < 1) newSec = 1;
    setTimerSec(newSec);
    try {
      const newMs = newSec * 1000;
      await apiClient.post('/settings/save', {
        whatsapp_pacing_min_ms: newMs.toString(),
        whatsapp_pacing_max_ms: (newMs + 2000).toString()
      });
      whatsappQueueEvent.triggerUpdated();
      toastEvent.trigger(`Timer set to ${newSec}s`, 'success');
    } catch (err) {
      toastEvent.trigger('Failed to save timer', 'error');
    }
  };

  // Generate 21 days starting from today
  const dateCards: DateCardItem[] = useMemo(() => {
    const cards: DateCardItem[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 21; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const isSunday = d.getDay() === 0;
      const holidayName = INDIAN_HOLIDAYS_2026[dateStr];
      const isToday = i === 0;
      const isPaused = pausedDates.includes(dateStr);

      cards.push({
        dateStr,
        dayName,
        dateNum: d.getDate(),
        monthName,
        isToday,
        isSunday,
        holidayName,
        isPaused
      });
    }
    return cards;
  }, [pausedDates]);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  return (
    <div className="w-full bg-bg2/90 border border-glass-border rounded-2xl p-1.5 shadow-sm mb-3 flex items-center justify-between gap-2 overflow-hidden transition-all shrink-0">
      
      {/* Left Controller Section: Title + Timer Presets */}
      <div className="flex items-center gap-2 shrink-0 pl-1">
        <div className="w-7 h-7 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
          <CalendarIcon size={14} />
        </div>
        <div className="hidden sm:flex items-center gap-1 text-[11px] font-bold text-text shrink-0">
          <span>Dispatch Schedule</span>
        </div>

        {/* Inline Timer Presets */}
        <div className="flex items-center gap-1 bg-bg px-2 py-1 rounded-xl border border-glass-border shrink-0">
          <Clock size={11} className="text-sky-400 shrink-0" />
          <div className="flex items-center gap-0.5">
            {[1, 5, 10, 30, 60].map(sec => (
              <button
                key={sec}
                type="button"
                onClick={() => handleTimerChange(sec)}
                className={`px-1.5 py-0.5 rounded-md text-[9px] font-black transition-all cursor-pointer ${
                  timerSec === sec
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'text-muted hover:text-text hover:bg-bg3'
                }`}
                title={`Set auto-send delay timer to ${sec}s`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Middle Section: Compact Horizontal Date Strip */}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex items-center gap-1.5 overflow-x-auto custom-scrollbar scroll-smooth py-0.5 px-1 min-w-0"
      >
        {dateCards.map((card) => {
          const isRed = card.isSunday || Boolean(card.holidayName);

          return (
            <button
              key={card.dateStr}
              type="button"
              onClick={() => togglePauseDate(card.dateStr)}
              className={`
                shrink-0 px-2 py-1 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-left select-none
                ${card.isPaused
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 ring-1 ring-amber-500/30'
                  : isRed
                    ? 'bg-rose-500/15 border-rose-500/35 hover:bg-rose-500/25 text-rose-300'
                    : card.isToday
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                      : 'bg-bg/80 border-glass-border/60 hover:bg-bg3 text-text'}
              `}
              title={`${card.dayName} ${card.dateNum} ${card.monthName} ${card.holidayName ? `(${card.holidayName})` : card.isSunday ? '(Sunday)' : ''} - Click to ${card.isPaused ? 'resume' : 'pause'}`}
            >
              {/* Day + Date Num */}
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-black uppercase ${isRed ? 'text-rose-400' : card.isToday ? 'text-sky-400' : 'text-muted'}`}>
                  {card.dayName}
                </span>
                <span className={`text-xs font-black leading-none ${isRed ? 'text-rose-400' : 'text-text'}`}>
                  {card.dateNum}
                </span>
              </div>

              {/* Status Badge: Paused vs Sunday/Holiday Red Label */}
              {card.isPaused ? (
                <span className="text-[9px] font-black px-1 rounded bg-amber-500/30 text-amber-300 border border-amber-500/40 flex items-center gap-0.5 shrink-0">
                  <Pause size={8} /> Paused
                </span>
              ) : isRed ? (
                <span className="text-[9px] font-black px-1 rounded bg-rose-500/30 text-rose-300 border border-rose-500/40 truncate max-w-[65px] shrink-0">
                  {card.holidayName || 'Sun'}
                </span>
              ) : (
                <span className="text-[8px] font-extrabold text-emerald-400 shrink-0">
                  <Play size={8} className="inline" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Right Navigation & Summary Controls */}
      <div className="flex items-center gap-1 shrink-0 pr-1">
        {pausedDates.length > 0 && (
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
            {pausedDates.length} Paused
          </span>
        )}
        <button
          type="button"
          onClick={scrollLeft}
          className="p-1 rounded-lg bg-bg border border-glass-border hover:bg-bg3 text-muted hover:text-text transition-all cursor-pointer"
          title="Scroll Left"
        >
          <ChevronLeft size={13} />
        </button>
        <button
          type="button"
          onClick={scrollRight}
          className="p-1 rounded-lg bg-bg border border-glass-border hover:bg-bg3 text-muted hover:text-text transition-all cursor-pointer"
          title="Scroll Right"
        >
          <ChevronRight size={13} />
        </button>
      </div>

    </div>
  );
};
