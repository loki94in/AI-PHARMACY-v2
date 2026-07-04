import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

interface ErrorRow {
  row: number;
  column: string;
  value: any;
  message: string;
}

interface ErrorRowsProps {
  errors: ErrorRow[];
}

export const ErrorRows: React.FC<ErrorRowsProps> = ({ errors }) => {
  const [expanded, setExpanded] = useState(false);

  if (!errors || errors.length === 0) return null;

  return (
    <div className="border border-rose-500/20 rounded-lg bg-rose-500/5 mt-4 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>{errors.length} rows contain issues / formatting problems</span>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="border-t border-rose-500/20 max-h-60 overflow-y-auto divide-y divide-rose-500/10">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-rose-500/10 text-rose-300 font-semibold">
                <th className="px-4 py-2 w-16">Row</th>
                <th className="px-4 py-2 w-32">Mapped Field</th>
                <th className="px-4 py-2 w-40">Value in File</th>
                <th className="px-4 py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rose-500/5 text-text/90">
              {errors.map((err, idx) => (
                <tr key={idx} className="hover:bg-rose-500/5 transition-colors">
                  <td className="px-4 py-2 font-mono">{err.row}</td>
                  <td className="px-4 py-2 text-rose-300 font-medium">{err.column}</td>
                  <td className="px-4 py-2 truncate font-mono max-w-[150px]" title={String(err.value)}>
                    {err.value === undefined || err.value === null ? (
                      <span className="text-muted italic">&lt;empty&gt;</span>
                    ) : (
                      String(err.value)
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{err.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
