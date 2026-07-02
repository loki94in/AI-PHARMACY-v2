import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const css = `
:root {
  --bg: #09090b;
  --bg2: #18181b;
  --bg3: #27272a;
  --border: #3f3f46;
  --text: #fafafa;
  --muted: #a1a1aa;
  
  --primary: #3b82f6; /* Modern Blue */
  --primary-glow: rgba(59, 130, 246, 0.4);
  
  --sky: #0ea5e9;
  --sky-bg: rgba(14, 165, 233, 0.15);
  
  --green: #10b981;
  --green-bg: rgba(16, 185, 129, 0.15);
  --green-glow: rgba(16, 185, 129, 0.4);
  
  --red: #ef4444;
  --red-bg: rgba(239, 68, 68, 0.15);
  --red-glow: rgba(239, 68, 68, 0.4);
  
  --amber: #f59e0b;
  --amber-bg: rgba(245, 158, 11, 0.15);
  
  --purple: #8b5cf6;
  --purple-glow: rgba(139, 92, 246, 0.4);
  
  --radius: 16px;
  --glass-bg: rgba(24, 24, 27, 0.7);
  --glass-border: rgba(255, 255, 255, 0.08);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { 
  font-family: 'Inter', sans-serif; 
  background: var(--bg); 
  color: var(--text); 
  min-height: 100vh;
  /* Abstract dark background pattern */
  background-image: 
    radial-gradient(circle at 15% 50%, rgba(59, 130, 246, 0.06), transparent 25%),
    radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.06), transparent 25%);
}
a { color:var(--sky); text-decoration:none; }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

/* Layout */
.app { display:flex; height:100vh; }
.sidebar { 
  width: 250px; 
  background: var(--glass-bg); 
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-right: 1px solid var(--glass-border); 
  display:flex; flex-direction:column; flex-shrink:0; overflow-y:auto; 
}
.sidebar-header { padding:24px 20px; border-bottom:1px solid var(--glass-border); }
.sidebar-header h1 { font-size:19px; font-weight:800; background:linear-gradient(135deg, #60a5fa, #c084fc); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; letter-spacing:-0.5px;}
.sidebar-header p { font-size:11px; color:var(--muted); margin-top:6px; letter-spacing:0.5px; text-transform:uppercase; font-weight:600;}
.nav-section { padding:16px 0; }
.nav-section-title { font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); padding:0 20px; margin-bottom:8px; opacity: 0.7;}
.nav-item { display:flex; align-items:center; gap:12px; padding:10px 20px; font-size:13px; font-weight:500; color:var(--muted); cursor:pointer; transition:all .25s ease; border-left:3px solid transparent; }
.nav-item:hover { color:var(--text); background: rgba(255,255,255,0.03); transform: translateX(4px); }
.nav-item.active { color:#fff; background: linear-gradient(90deg, rgba(59, 130, 246, 0.15), transparent); border-left-color: var(--primary); text-shadow: 0 0 10px rgba(59,130,246,0.5); }
.nav-item i { width:18px; text-align:center; font-size:14px; transition:all .25s ease;}
.nav-item.active i { color: var(--primary); filter: drop-shadow(0 0 8px var(--primary-glow)); }

.main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.topbar { padding:12px 20px; border-bottom:1px solid var(--glass-border); background: var(--glass-bg); backdrop-filter: blur(12px); display:flex; justify-content:space-between; align-items:center; }
.topbar h2 { font-size:18px; font-weight:700; letter-spacing:-0.3px;}
.topbar .subtitle { font-size:13px; color:var(--muted); }
.content { flex:1; overflow-y:auto; padding:16px; }

/* Views */
.view { display:none; animation: fadeIn 0.4s ease forwards; }
.view.active { display:block; }
@keyframes fadeIn { from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }

/* Dashboard Specifics */
.dash-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; }
.dash-welcome h2 { font-size: 28px; font-weight: 800; letter-spacing: -1px; margin-bottom: 4px; }
.dash-welcome p { color: var(--muted); font-size: 14px; }
.dash-date { font-size: 13px; font-weight: 600; color: var(--sky); background: var(--sky-bg); padding: 8px 16px; border-radius: 20px; }

/* Cards */
.card { 
  background: var(--glass-bg); 
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border); 
  border-radius: var(--radius); 
  margin-bottom: 12px; 
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.card-header { padding:10px 18px; border-bottom:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center; }
.card-header h3 { font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px;}
.card-body { padding:12px 18px; }

/* Buttons */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 20px; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; transition:all .2s ease; font-family:inherit; position: relative; overflow: hidden; }
.btn::after { content:''; position:absolute; inset:0; background:linear-gradient(rgba(255,255,255,0.1), transparent); opacity:0; transition:opacity .2s; }
.btn:hover::after { opacity:1; }
.btn:active { transform: scale(0.97); }

.btn-sky { background:var(--primary); color:#fff; box-shadow: 0 4px 14px var(--primary-glow); }
.btn-sky:hover { background: #2563eb; }
.btn-green { background:var(--green); color:#fff; box-shadow: 0 4px 14px var(--green-glow); }
.btn-green:hover { background: #059669; }
.btn-red { background:var(--red); color:#fff; box-shadow: 0 4px 14px var(--red-glow); }
.btn-red:hover { background: #dc2626; }
.btn-amber { background:var(--amber); color:#fff; }
.btn-outline { background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); color:var(--text); }
.btn-outline:hover { background:rgba(255,255,255,0.08); }
.btn-sm { padding:6px 12px; font-size:12px; border-radius:6px;}

/* Inputs */
input, select, textarea { 
  background: rgba(0,0,0,0.2); 
  border: 1px solid var(--border); 
  border-radius: 8px; 
  padding: 10px 14px; 
  color: var(--text); 
  font-size: 13px; 
  font-family: inherit; 
  outline: none; 
  width: 100%; 
  transition: all .2s ease; 
}
input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-glow); background: rgba(0,0,0,0.4); }
label { display:block; font-size:11px; font-weight:600; color:var(--muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; }
.input-group { margin-bottom:16px; }
.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }

/* Status badges */
.badge { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;}
.badge-green { background:var(--green-bg); color:var(--green); border:1px solid rgba(16,185,129,0.2); }
.badge-red { background:var(--red-bg); color:var(--red); border:1px solid rgba(239,68,68,0.2); }
.badge-sky { background:var(--sky-bg); color:var(--sky); border:1px solid rgba(14,165,233,0.2); }
.badge-amber { background:var(--amber-bg); color:var(--amber); border:1px solid rgba(245,158,11,0.2); }

/* Results / Log */
.log-area { background: rgba(0,0,0,0.4); border:1px solid var(--glass-border); border-radius:8px; padding:16px; font-family:'JetBrains Mono','Fira Code',monospace; font-size:12px; line-height:1.7; max-height:350px; overflow-y:auto; white-space:pre-wrap; word-break:break-all; }
.log-success { color:var(--green); }
.log-error { color:var(--red); }
.log-info { color:var(--sky); }

/* Tables */
table { width:100%; border-collapse: separate; border-spacing: 0; }
th { text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); padding:12px 14px; border-bottom:1px solid var(--glass-border); position:sticky; top:0; background: rgba(24,24,27,0.9); backdrop-filter: blur(8px); z-index:10; }
td { padding:12px 14px; font-size:13px; border-bottom:1px solid var(--glass-border); transition: background 0.2s; }
tr { transition: transform 0.2s; }
tr:hover td { background: rgba(255,255,255,0.03); }

.table-container { max-height:65vh; overflow-y:auto; overflow-x:auto; border-radius: 8px; border: 1px solid var(--glass-border); background: rgba(0,0,0,0.2); }
.col-filter { width:100%; padding:6px 8px; font-size:11px; border:1px solid var(--border); border-radius:6px; margin-top:6px; outline:none; background: rgba(0,0,0,0.3); color:var(--text); box-sizing:border-box; transition: all 0.2s;}
.col-filter:focus { border-color:var(--primary); }

/* Stat cards row */
.stat-row { display:grid; grid-template-columns:repeat(4,1fr); gap:20px; margin-bottom:32px; }
.stat-card { 
  background: var(--glass-bg); 
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border); 
  border-radius: var(--radius); 
  padding: 24px; 
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0,0,0,0.2);
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.stat-card:hover { transform: translateY(-4px); }
.stat-card::before {
  content: '';
  position: absolute;
  top: 0; right: 0;
  width: 100px; height: 100px;
  background: radial-gradient(circle, var(--glow-color, rgba(255,255,255,0.1)) 0%, transparent 70%);
  opacity: 0.5;
  transform: translate(30%, -30%);
}
.stat-icon { position:absolute; right:20px; top:24px; font-size:24px; color: var(--muted); opacity:0.3; }
.stat-card .stat-label { font-size:12px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }
.stat-card .stat-val { font-size:32px; font-weight:800; margin-top:10px; letter-spacing: -1px; }
.stat-trend { margin-top: 12px; font-size:12px; font-weight:600; display:flex; align-items:center; gap:4px; }
.trend-up { color: var(--green); }
.trend-down { color: var(--red); }

/* Toast / Soft Notification */
#toast-container { position:fixed; top:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:12px; }
.toast { padding:14px 20px; border-radius:12px; font-size:13px; font-weight:500; display:flex; align-items:center; gap:12px; animation:slideIn .4s cubic-bezier(0.16, 1, 0.3, 1); min-width:260px; background: rgba(24,24,27,0.9); backdrop-filter: blur(10px); color:var(--text); box-shadow: 0 10px 40px rgba(0,0,0,0.3); border:1px solid var(--glass-border); }
.toast.success { border-left:4px solid var(--green); }
.toast.error { border-left:4px solid var(--red); }
.toast.info { border-left:4px solid var(--primary); }
@keyframes slideIn { from{opacity:0;transform:translateY(-20px) scale(0.95);} to{opacity:1;transform:translateY(0) scale(1);} }

/* Modal Overlay */
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.8); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); z-index:5000; display:none; align-items:center; justify-content:center; }
.modal-overlay.open { display:flex; animation: fadeIn 0.2s ease; }
.modal-box { background:var(--bg2); border:1px solid var(--glass-border); border-radius:16px; width:90vw; max-width:950px; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 24px 80px rgba(0,0,0,0.6); }
.modal-top { padding:20px 28px; border-bottom:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.02);}
.modal-top h3 { font-size:18px; font-weight:700; display:flex; align-items:center; gap:10px; }
.modal-scroll { flex:1; overflow-y:auto; padding:24px 28px; }
.modal-bottom { padding:16px 28px; border-top:1px solid var(--glass-border); display:flex; justify-content:flex-end; gap:12px; background: rgba(255,255,255,0.02); border-bottom-left-radius:16px; border-bottom-right-radius:16px;}

.map-table { width:100%; border-collapse:collapse; }
.map-table th { background:rgba(0,0,0,0.2); padding:12px 14px; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); text-align:left; position:sticky; top:0; z-index:1; }
.map-table td { padding:12px 14px; border-bottom:1px solid var(--glass-border); }
.map-table tr:hover { background:rgba(255,255,255,0.03); }
.map-table select { background:rgba(0,0,0,0.4); border:1px solid var(--border); color:var(--text); padding:8px 12px; border-radius:6px; font-size:12px; font-family:inherit; width:100%; }
.map-arrow { color:var(--primary); font-size:16px; text-align:center; }

/* Auto-generated Utility Classes */
.flex-row-center { display:flex;gap:12px;align-items:center; }
.font-xs { font-size:9px; }
.w-100-px { width:100px;padding:6px 10px; }
.w-220-px { width:220px; }
.form-panel { display:none;padding:24px 28px;border-bottom:1px solid var(--glass-border);background:rgba(0,0,0,0.2); }
.flex-col-end { display:flex;align-items:flex-end; }
.p-0 { padding:0; }
.w-200-px { width:200px; }
.flex-row-gap-12 { display:flex;gap:16px; }
.w-80-px { width:80px; }
.w-150-px { width:150px; }
.w-120-px { width:120px; }
.flex-1 { flex:1; }
.grid-1-2 { display:grid;grid-template-columns:1fr 2fr;gap:20px; }
.grid-1-1 { display:grid;grid-template-columns:1fr 1fr;gap:20px; }
.map-container { width:100%;height:400px; border-radius: 8px; overflow: hidden; border: 1px solid var(--glass-border); }
.p-20 { padding:24px; }
.hidden-p20 { display:none;padding:24px;background:rgba(0,0,0,0.2); border-radius: 8px; margin-top: 16px; border: 1px solid var(--glass-border);}
.text-right { text-align:right; }
.empty-state-text { text-align:center;color:var(--muted);padding:40px 20px; font-size:14px; font-style: italic;}
.mono-sm { font-family:monospace;font-size:13px; }
.text-sm { font-size:12px; }
.font-bold { font-weight:700; }
.text-red { color:var(--red) }
.font-bold-amber { font-weight:700;color:var(--amber); }
.font-bold-muted { font-weight:700;color:var(--muted); }
.text-green-bold { color:var(--green);font-weight:700; }
.filter-panel { background:rgba(0,0,0,0.2);padding:20px;border:1px solid var(--glass-border);margin-bottom:20px;border-radius:var(--radius); box-shadow: inset 0 2px 10px rgba(0,0,0,0.1); }
.grid-4-end { display:grid;grid-template-columns:repeat(4, 1fr);gap:16px;align-items:end; }

.hide-col-0 th:nth-child(1), .hide-col-0 td:nth-child(1) { display: none !important; }
.hide-col-1 th:nth-child(2), .hide-col-1 td:nth-child(2) { display: none !important; }
.hide-col-2 th:nth-child(3), .hide-col-2 td:nth-child(3) { display: none !important; }
.hide-col-3 th:nth-child(4), .hide-col-3 td:nth-child(4) { display: none !important; }
.hide-col-4 th:nth-child(5), .hide-col-4 td:nth-child(5) { display: none !important; }
.hide-col-5 th:nth-child(6), .hide-col-5 td:nth-child(6) { display: none !important; }
.hide-col-6 th:nth-child(7), .hide-col-6 td:nth-child(7) { display: none !important; }
.hide-col-7 th:nth-child(8), .hide-col-7 td:nth-child(8) { display: none !important; }
.hide-col-8 th:nth-child(9), .hide-col-8 td:nth-child(9) { display: none !important; }
.hide-col-9 th:nth-child(10), .hide-col-9 td:nth-child(10) { display: none !important; }

/* Hide number input spinners in table */
.no-spinners input[type="number"]::-webkit-inner-spin-button,
.no-spinners input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.no-spinners input[type="number"] {
  -moz-appearance: textfield;
}
`;

const htmlPath = path.resolve(__dirname, '..', 'test-console.html');
const content = fs.readFileSync(htmlPath, 'utf8');

const regex = /<style>[\s\S]*?<\/style>/;
const newContent = content.replace(regex, '<style>\n' + css + '\n</style>');

fs.writeFileSync(htmlPath, newContent, 'utf8');
console.log('CSS Replaced successfully');
