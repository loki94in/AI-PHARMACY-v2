import React from 'react';
import { X, Globe, Check, Ban, Loader2 } from 'lucide-react';
import { api, type ScheduleUnclassifiedItem, type ScheduleResearchMatch } from '../../../services/api';
import { useApiQuery, useApiMutation } from '../../../hooks/useApiQuery';

const MATCH_STYLE: Record<string, string> = {
  H1: 'bg-amber-400/30 border-amber-400 text-amber-300',
  H: 'bg-sky-400/30 border-sky-400 text-sky-200',
  X: 'bg-rose-400/30 border-rose-400 text-rose-300',
};

const MATCH_CHIP: Record<string, string> = {
  H1: 'bg-amber-500/15 border-amber-500/40 text-amber-400',
  H: 'bg-sky-500/15 border-sky-500/40 text-sky-400',
  X: 'bg-rose-500/15 border-rose-500/40 text-rose-400',
};

interface Props {
  item: ScheduleUnclassifiedItem;
  onClose: () => void;
  onClassified: (scheduleType: string) => void;
}

const ScheduleResearchModal: React.FC<Props> = ({ item, onClose, onClassified }) => {
  const research = useApiQuery<Awaited<ReturnType<typeof api.researchScheduleDrug>>>(
    ['schedule-drugs-research', item.id],
    () => api.researchScheduleDrug(item.id),
    { staleTime: 10 * 60_000, retry: 0 },
  );

  const classify = useApiMutation(
    (vars: { scheduleType: 'H1' | 'H' | 'X' | 'NONE'; keywords: string[] }) =>
      api.classifyScheduleDrug(item.id, vars.scheduleType, { keywords: vars.keywords }),
    {
      onSuccess: (_data, variables) => onClassified(variables.scheduleType),
      invalidateKeys: [['schedule-drugs-review'], ['schedule-drugs-summary'], ['schedule-drugs-list']],
    },
  );

  const r = research.data;
  const exactMatches = r?.matches.filter((m) => m.exact) ?? [];
  const fuzzyMatches = r?.matches.filter((m) => !m.exact) ?? [];

  const renderBox = (m: ScheduleResearchMatch, idx: number) => {
    if (!m.bbox || !r) return null;
    return (
      <div
        key={`${m.word}-${idx}`}
        title={m.exact ? `${m.keyword} · Schedule ${m.schedule}` : `similar to ${m.keyword} · Schedule ${m.schedule}`}
        className={`absolute rounded border-2 pointer-events-none ${m.exact ? MATCH_STYLE[m.schedule] : 'border-dashed ' + MATCH_STYLE[m.schedule]}`}
        style={{
          left: `${(m.bbox.x0 / r.imageWidth) * 100}%`,
          top: `${(m.bbox.y0 / r.imageHeight) * 100}%`,
          width: `${((m.bbox.x1 - m.bbox.x0) / r.imageWidth) * 100}%`,
          height: `${((m.bbox.y1 - m.bbox.y0) / r.imageHeight) * 100}%`,
        }}
      />
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[92vh] overflow-y-auto scrollbar-thin bg-bg border border-glass-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-sticky-header bg-bg/95 backdrop-blur border-b border-glass-border px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Globe size={16} className="text-primary shrink-0" />
              <h2 className="text-base font-black text-text truncate">{item.name}</h2>
              {r?.suggestion && (
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${MATCH_CHIP[r.suggestion]}`}>
                  Suggested: Schedule {r.suggestion}
                </span>
              )}
              {r && (
                <span className="text-[9px] font-bold text-muted uppercase tracking-wider px-2 py-0.5 rounded-full bg-bg3 border border-glass-border">
                  via {r.engine === 'google' ? 'Google' : 'DuckDuckGo'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted mt-1 truncate">Query: “{r?.query ?? '…'}”</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {research.isLoading && (
            <div className="py-16 flex flex-col items-center gap-3">
              <Loader2 size={26} className="animate-spin text-primary" />
              <p className="text-xs font-bold text-muted uppercase tracking-wider">One Google search → screenshot → OCR…</p>
            </div>
          )}

          {research.isError && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl text-xs text-amber-400 font-semibold">
              Google lookup failed: {(research.error as Error)?.message || 'unknown error'}. You can still classify
              this medicine manually below from your own knowledge.
            </div>
          )}

          {r && (
            <>
              {r.googleBlocked && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-[11px] text-amber-400 font-semibold">
                  Google showed a bot-check instead of results. Wait a bit and try again, or classify manually below.
                </div>
              )}
              {r.likelyNonDrug && (
                <div className="p-3 bg-zinc-500/10 border border-border rounded-xl text-[11px] text-muted font-semibold">
                  Name looks like a cosmetic / personal-care item — schedules usually do not apply.
                </div>
              )}

              {/* Screenshot with highlighted API words */}
              <div className="relative rounded-xl overflow-hidden border border-glass-border">
                <img src={r.imageDataUrl} alt="Google search results" className="w-full block" />
                {r.matches.map(renderBox)}
              </div>

              {/* Matched API words */}
              <div>
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">
                  Matched API words ({exactMatches.length} exact{fuzzyMatches.length ? `, ${fuzzyMatches.length} similar` : ''})
                </p>
                {r.matches.length === 0 ? (
                  <p className="text-xs text-muted font-medium">No schedule keyword found in the screenshot. Classify manually or mark Not Scheduled.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {r.matches.map((m, i) => (
                      <span
                        key={`${m.word}-${i}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${MATCH_CHIP[m.schedule]}`}
                      >
                        “{m.word}” → {m.keyword}
                        {!m.exact && <em className="not-italic text-[9px] opacity-70">(similar)</em>}
                        <span className="opacity-80">· {m.schedule}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Ignored filler words log */}
              {r.ignoredWords.length > 0 && (
                <details className="bg-bg2 border border-glass-border rounded-xl px-4 py-3">
                  <summary className="text-[11px] font-bold text-muted cursor-pointer select-none">
                    Ignored {r.ignoredWords.length} filler words (a, the, of, mg, strip…)
                  </summary>
                  <p className="text-[11px] text-muted mt-2 leading-relaxed break-words">
                    {r.ignoredWords.join(', ')}
                  </p>
                </details>
              )}
            </>
          )}

          {/* Human-in-the-loop confirm actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-glass-border">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider mr-1">Pharmacist confirms:</span>
            {(['H1', 'H', 'X'] as const).map((t) => (
              <button
                key={t}
                disabled={classify.isPending || research.isLoading}
                onClick={() => classify.mutate({ scheduleType: t, keywords: (r?.matches ?? []).map((m) => m.keyword) })}
                className={`px-4 py-2 rounded-xl text-xs font-black border transition-all cursor-pointer disabled:opacity-40 ${MATCH_CHIP[t]} hover:brightness-110`}
              >
                <Check size={12} className="inline mr-1 -mt-0.5" />Confirm {t}
              </button>
            ))}
            <button
              disabled={classify.isPending || research.isLoading}
              onClick={() => classify.mutate({ scheduleType: 'NONE', keywords: [] })}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-bg3 border border-glass-border text-muted hover:text-text transition-all cursor-pointer disabled:opacity-40"
            >
              <Ban size={12} className="inline mr-1 -mt-0.5" />Not Scheduled
            </button>
            <span className="ml-auto text-[10px] text-muted">
              Saved to master DB only after your click.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleResearchModal;
