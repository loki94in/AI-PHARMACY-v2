import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { History, Search, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CustomerReturnHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await api.getCustomerReturnsHistory();
      setHistory(data);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <button 
            onClick={() => navigate('/customer-returns')}
            className="text-muted hover:text-text text-sm flex items-center gap-1 mb-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Returns
          </button>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <History className="w-6 h-6 text-sky" />
            Customer Return History
          </h1>
        </div>
      </div>

      <div className="premium-card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <History className="w-8 h-8 text-muted" />
            </div>
            <h3 className="text-lg font-medium text-text mb-1">No Returns Yet</h3>
            <p className="text-sm text-muted">Customer returns will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 border-b border-white/10 text-muted">
                <tr>
                  <th className="p-4 font-medium">Return No</th>
                  <th className="p-4 font-medium">Date</th>
                  <th className="p-4 font-medium">Original Invoice</th>
                  <th className="p-4 font-medium">Items Returned</th>
                  <th className="p-4 font-medium text-right">Refund Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {history.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5 transition-colors group">
                    <td className="p-4 font-medium text-text">{row.return_no}</td>
                    <td className="p-4 text-muted">{new Date(row.date).toLocaleString()}</td>
                    <td className="p-4 text-sky">{row.original_invoice_no}</td>
                    <td className="p-4">
                      <div className="text-xs space-y-1">
                        {row.items?.map((i: any, idx: number) => (
                          <div key={idx} className="text-muted">
                            {i.quantity}x {i.medicine_name}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-right font-medium text-emerald">
                      ₹{row.total_amount?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
