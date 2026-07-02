import { Plus } from 'lucide-react';

const BrandBanner = () => (
  <div className="flex items-center justify-end border-b border-glass-border/30 pb-2 bg-gradient-to-r from-sky/10 via-transparent to-transparent px-2">
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold text-muted font-mono">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green/10 border border-green/20 text-[9px] font-bold text-green uppercase tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>
        Online Counter
      </div>
    </div>
  </div>
);

export default BrandBanner;
