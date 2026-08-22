import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar as Clock, Pause, Play, ChevronLeft, ChevronRight, ShoppingCart, Send } from 'lucide-react';
import { api, apiClient } from '../services/api';
import { toastEvent } from '../services/events';

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

interface PharmarackCartCalendarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  hasUnreadSentHistory?: boolean;
  activeCount?: number;
  reorderCount?: number;
}

export const PharmarackCartCalendar: React.FC<PharmarackCartCalendarProps> = ({
  currentTab,
  onTabChange,
  hasUnreadSentHistory = false,
  activeCount = 0,
  reorderCount = 0,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayCardRef = useRef<HTMLButtonElement>(null);

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

  const handleTimerChange = (sec: number) => {
    setTimerSec(sec);
    localStorage.setItem('pharmarack_cart_timer_sec', String(sec));
    toastEvent.trigger(`Auto-send delay set to ${sec}s per order`, 'info');
  };

  // Generate 21-day rolling date strip (-3 days ago to +17 days ahead)
  const dateCards = useMemo(() => {
    const cards: DateCardItem[] = [];
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    for (let offset = -3; offset <= 17; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      const dateStr = d.toISOString().split('T')[0];
      const isSunday = d.getDay() === 0;
      const isToday = dateStr === todayStr;
      const holidayName = INDIAN_HOLIDAYS_2026[dateStr];
      const isPaused = pausedDates.includes(dateStr);

      cards.push({
        dateStr,
        dayName: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        dateNum: d.getDate(),
        monthName: d.toLocaleDateString('en-IN', { month: 'short' }),
        isToday,
        isSunday,
        holidayName,
        isPaused
      });
    }
    return cards;
  }, [pausedDates]);

  // Center scroll on today's card on initial load
  useEffect(() => {
    if (todayCardRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const card = todayCardRef.current;
      const scrollPos = card.offsetLeft - container.offsetWidth / 2 + card.offsetWidth / 2;
      container.scrollTo({ left: Math.max(0, scrollPos), behavior: 'smooth' });
    }
  }, []);

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
    <div className="w-full bg-bg2 border border-glass-border rounded-2xl p-1.5 shadow-sm mb-1.5 space-y-1.5 shrink-0 transition-all">
      
      {/* Top Controls Row: Integrated Navigation Tabs + Timer Pacing Presets */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-glass-border/30">
        
        {/* Integrated Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-bg p-1 rounded-xl border border-glass-border shrink-0 overflow-x-auto">
          {/* Tab 1: Reorder Hub */}
          <button
            type="button"
            onClick={() => onTabChange('reorder')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'reorder'
                ? 'bg-amber-500/20 text-amber-400 font-black shadow-xs border border-amber-500/40'
                : reorderCount > 0
                  ? 'text-amber-400 hover:bg-amber-500/10'
                  : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Customer requests, refills due, sales-weighted restock suggestions, and recently ordered medicines"
          >
            <Clock size={13} className={currentTab === 'reorder' || reorderCount > 0 ? 'text-amber-400' : 'text-muted'} />
            <span>Reorder Hub</span>
            {reorderCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/40 font-mono font-bold">
                {reorderCount}
              </span>
            )}
          </button>

          {/* Tab 2: Supplier PO Grouping */}
          <button
            type="button"
            onClick={() => onTabChange('cart')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'cart' || !currentTab
                ? 'bg-bg2 text-primary font-black shadow-xs border border-border'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Review grouped distributor carts and create Purchase Orders"
          >
            <ShoppingCart size={13} className={currentTab === 'cart' || !currentTab ? 'text-primary' : 'text-muted'} />
            <span>Supplier PO Grouping</span>
            {activeCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/15 text-primary border border-primary/20 font-mono font-bold">
                {activeCount}
              </span>
            )}
          </button>

          {/* Tab 3: Sent Orders History */}
          <button
            type="button"
            onClick={() => onTabChange('sent-history')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap relative ${
              currentTab === 'sent-history'
                ? 'bg-bg2 text-primary font-black shadow-xs border border-border'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
          >
            <Send size={13} className={currentTab === 'sent-history' ? 'text-primary' : 'text-muted'} />
            <span>Sent PO History</span>
            {hasUnreadSentHistory && currentTab !== 'sent-history' && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </button>
        </div>

        {/* Timer Pacing Selector & Controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1 bg-bg px-2.5 py-1 rounded-xl border border-glass-border">
            <Clock size={12} className="text-sky-400 shrink-0" />
            <span className="text-[11px] font-bold text-muted truncate mr-1">Delay:</span>
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

          <div className="flex items-center gap-1">
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

      </div>

      {/* Date Strip: High Contrast & Crystal Clear Text */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar scroll-smooth py-0.5 px-0.5 min-w-0"
      >
        {dateCards.map((card) => {
          const isRed = card.isSunday || Boolean(card.holidayName);

          return (
            <button
              key={card.dateStr}
              ref={card.isToday ? todayCardRef : undefined}
              type="button"
              onClick={() => togglePauseDate(card.dateStr)}
              className={`
                shrink-0 px-2 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-left select-none bg-bg
                ${card.isPaused
                  ? 'border-amber-500/60 ring-1 ring-amber-500/40 text-amber-400'
                  : isRed
                    ? 'border-rose-500/40 hover:border-rose-500/70 text-rose-400 font-bold'
                    : card.isToday
                      ? 'border-sky-400 ring-2 ring-sky-400/80 shadow-[0_0_15px_rgba(56,189,248,0.6)] text-sky-300 font-black animate-pulse'
                      : 'border-glass-border hover:border-border text-text'}
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

              {/* Status Badge */}
              {card.isPaused ? (
                <span className="text-[9px] font-black px-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-0.5 shrink-0">
                  <Pause size={8} /> Paused
                </span>
              ) : isRed ? (
                <span className="text-[9px] font-black px-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 truncate max-w-[65px] shrink-0">
                  {card.holidayName || 'Sun'}
                </span>
              ) : card.isToday ? (
                <span className="text-[9px] font-black px-1 rounded bg-sky-500/20 text-sky-400 border border-sky-500/40 shrink-0">
                  Today
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

    </div>
  );
};
