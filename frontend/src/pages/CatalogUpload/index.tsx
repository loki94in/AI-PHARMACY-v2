import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Database, Upload, FileText, CheckCircle, AlertCircle, Loader2, History, Check, AlertTriangle, Play, RefreshCw, Trash2, X } from 'lucide-react';
import { api, apiClient } from '../../services/api';

interface CatalogJob {
  id: number;
  file_path: string;
  original_filename: string | null;
  status: 'pending' | 'processing' | 'ready_for_review' | 'done' | 'failed' | 'waiting_for_mapping' | 'paused' | 'pending_analysis' | 'processing_analysis';
  created_at: string;
  total_count?: number;
  existing_count?: number;
  new_count?: number;
  duplicate_count?: number;
  progress?: number;
  error_log?: string | null;
}

const AVAILABLE_DB_SECTIONS = [
  {
    label: 'Common / Product Info',
    fields: [
      { value: 'name', label: 'Product Name (Required)' },
      { value: 'api_reference', label: 'Composition / Generic' },
      { value: 'strength', label: 'Strength' },
      { value: 'packaging', label: 'Packaging Type' },
      { value: 'manufacturer', label: 'Manufacturer' },
      { value: 'marketed_by', label: 'Marketed By' },
      { value: 'hsn_code', label: 'HSN Code' },
      { value: 'schedule_type', label: 'Schedule Type' }
    ]
  },
  {
    label: '💰 Pricing & Taxes',
    fields: [
      { value: 'mrp', label: 'MRP (Price)' },
      { value: 'cgst', label: 'CGST %' },
      { value: 'sgst', label: 'SGST %' }
    ]
  },
  {
    label: '📦 Stock & Batch details',
    fields: [
      { value: 'quantity', label: 'Stock Quantity' },
      { value: 'batch_no', label: 'Batch Number' },
      { value: 'expiry_date', label: 'Expiry Date' },
      { value: 'rack', label: 'Rack Location' }
    ]
  }
];

const getFieldLabelAndSection = (value: string) => {
  for (const section of AVAILABLE_DB_SECTIONS) {
    const field = section.fields.find(f => f.value === value);
    if (field) return { section: section.label, label: field.label };
  }
  return { section: 'Unknown', label: value };
};

const getMappingColor = (targetCol: string) => {
  if (!targetCol) return 'ignored';
  
  if (targetCol.startsWith('custom_col_')) {
    return 'blue';
  }
  
  const blueFields = ['name', 'api_reference', 'strength', 'packaging', 'manufacturer', 'marketed_by', 'hsn_code', 'schedule_type', 'generic_name', 'category'];
  if (blueFields.includes(targetCol)) return 'blue';
  
  const greenFields = ['quantity', 'batch_no', 'expiry_date', 'rack', 'rack_location'];
  if (greenFields.includes(targetCol)) return 'green';
  
  const yellowFields = ['mrp', 'cost_price', 'total_amount', 'cgst', 'sgst', 'discount', 'invoice_no', 'date'];
  if (yellowFields.includes(targetCol)) return 'yellow';
  
  const purpleFields = ['patient_name', 'distributor_name', 'doctor_name', 'phone', 'mobile', 'address', 'notes'];
  if (purpleFields.includes(targetCol)) return 'purple';
  
  return 'ignored';
};

const getHighlightStyles = (targetCol: string, isHovered: boolean) => {
  const color = getMappingColor(targetCol);
  
  if (color === 'blue') {
    return {
      header: isHovered ? 'bg-blue-500/20 text-blue-300 border-blue-500/80 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      cell: isHovered ? 'bg-blue-500/15 border-r border-blue-500/30 text-blue-300' : 'bg-blue-500/5 border-r border-blue-500/20 text-blue-400/90'
    };
  }
  if (color === 'green') {
    return {
      header: isHovered ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/80 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      cell: isHovered ? 'bg-emerald-500/15 border-r border-emerald-500/30 text-emerald-300' : 'bg-emerald-500/5 border-r border-emerald-500/20 text-emerald-400/90'
    };
  }
  if (color === 'yellow') {
    return {
      header: isHovered ? 'bg-amber-500/20 text-amber-300 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      cell: isHovered ? 'bg-amber-500/15 border-r border-amber-500/30 text-amber-300' : 'bg-amber-500/5 border-r border-amber-500/20 text-amber-400/90'
    };
  }
  if (color === 'purple') {
    return {
      header: isHovered ? 'bg-purple-500/20 text-purple-300 border-purple-500/80 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      cell: isHovered ? 'bg-purple-500/15 border-r border-purple-500/30 text-purple-300' : 'bg-purple-500/5 border-r border-purple-500/20 text-purple-400/90'
    };
  }
  
  // ponytail: fallback for 'ignored' columns — prevents crash when accessing styles.header / styles.cell
  return {
    header: isHovered ? 'bg-white/10 text-gray-200 border-white/40' : 'bg-white/5 text-gray-500 border-glass-border opacity-50 grayscale',
    cell: isHovered ? 'bg-white/5 border-r border-white/10 text-gray-200' : 'border-r border-glass-border/10 text-gray-500 opacity-50 grayscale'
  };
};

interface ReviewDetailPaneProps {
  review: any;
  onApproved: () => void;
  onRejected: () => void;
  googleSearchStatus: { count: number; limit: number } | null;
}

const ReviewDetailPane = ({ review, onApproved, onRejected, googleSearchStatus }: ReviewDetailPaneProps) => {
  const [name, setName] = useState('');
  const [apiReference, setApiReference] = useState('');
  const [strength, setStrength] = useState('');
  const [packaging, setPackaging] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [marketedBy, setMarketedBy] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);

  useEffect(() => {
    if (review) {
      setName(review.approved_json?.name || review.extracted_json?.name || review.medicine_name || '');
      setApiReference(review.approved_json?.api_reference || review.extracted_json?.api_reference || review.original_row_data?.api_reference || '');
      setStrength(review.approved_json?.strength || review.extracted_json?.strength || review.original_row_data?.strength || '');
      setPackaging(review.approved_json?.packaging || review.extracted_json?.dosage_form || review.original_row_data?.packaging || '');
      setManufacturer(review.approved_json?.manufacturer || review.extracted_json?.manufacturer || review.original_row_data?.manufacturer || '');
      setMarketedBy(review.approved_json?.marketed_by || review.original_row_data?.marketed_by || review.extracted_json?.manufacturer || '');
    }
  }, [review]);

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      const data = {
        name,
        api_reference: apiReference,
        strength,
        packaging,
        manufacturer,
        marketed_by: marketedBy
      };
      await api.approveCatalogReview(review.id, data);
      alert('Record approved and master catalog updated.');
      onApproved();
    } catch (err: any) {
      alert('Failed to approve: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('Are you sure you want to reject this item? It will be skipped from the catalog import.')) {
      return;
    }
    setIsSubmitting(true);
    try {
      await api.rejectCatalogReview(review.id);
      onRejected();
    } catch (err: any) {
      alert('Failed to reject: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualEnrich = async () => {
    setIsEnriching(true);
    try {
      await api.enrichCatalogReview(review.id);
      alert('Background Google search enrichment triggered. Please wait 5-10 seconds for it to refresh.');
    } catch (err: any) {
      alert('Failed to enrich: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsEnriching(false);
    }
  };

  const cleanBaseUrl = (apiClient.defaults.baseURL || window.location.origin).replace('/api', '').replace(/\/$/, '');
  const screenshotUrl = review.screenshot_path ? `${cleanBaseUrl}/${review.screenshot_path.replace(/\\/g, '/')}` : '';

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <div className="flex flex-wrap justify-between items-start border-b border-glass-border/30 pb-3 gap-3">
        <div>
          <h4 className="text-base font-bold text-white truncate max-w-[400px]">{review.medicine_name}</h4>
          <span className="text-[10px] text-gray-400">Review and verify composition mappings for database catalog creation</span>
        </div>
        
        {googleSearchStatus && (
          <div className="bg-black/40 border border-glass-border/30 px-3 py-1.5 rounded-lg text-[10px] text-gray-300 font-mono self-start">
            Google Limit: <span className="font-bold text-white">{googleSearchStatus.count}</span> / <span className="text-muted">{googleSearchStatus.limit}</span> day
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Form Inputs (Left) */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Brand Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2.5 outline-none focus:border-primary font-semibold"
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Active Composition (API)</label>
              <input
                type="text"
                value={apiReference}
                onChange={e => setApiReference(e.target.value)}
                className="bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2.5 outline-none focus:border-primary font-semibold"
                placeholder="e.g. Paracetamol + Caffeine"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Strength</label>
              <input
                type="text"
                value={strength}
                onChange={e => setStrength(e.target.value)}
                className="bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2.5 outline-none focus:border-primary"
                placeholder="e.g. 650 mg"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Dosage Form / Packaging</label>
              <input
                type="text"
                value={packaging}
                onChange={e => setPackaging(e.target.value)}
                className="bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2.5 outline-none focus:border-primary"
                placeholder="e.g. Tablet"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Manufacturer</label>
              <input
                type="text"
                value={manufacturer}
                onChange={e => setManufacturer(e.target.value)}
                className="bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2.5 outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Marketed By</label>
              <input
                type="text"
                value={marketedBy}
                onChange={e => setMarketedBy(e.target.value)}
                className="bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2.5 outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={handleApprove}
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-green hover:bg-green/90 text-white text-xs font-bold rounded-lg shadow-lg hover:shadow-green/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check size={14} /> Approve & Save
            </button>
            <button
              onClick={handleReject}
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <X size={14} /> Skip / Reject
            </button>
            <button
              onClick={handleManualEnrich}
              disabled={isEnriching}
              className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-glass-border text-gray-300 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 ml-auto"
            >
              <RefreshCw size={14} className={isEnriching ? 'animate-spin' : ''} /> Enrich with Google Search
            </button>
          </div>

          {review.raw_ocr_text && (
            <details className="mt-4 border border-glass-border/30 rounded-lg overflow-hidden bg-black/40">
              <summary className="p-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide cursor-pointer hover:bg-white/5 select-none">
                View Raw OCR Text Source
              </summary>
              <pre className="p-3 text-[10px] text-gray-500 font-mono whitespace-pre-wrap max-h-[150px] overflow-y-auto border-t border-glass-border/20">
                {review.raw_ocr_text}
              </pre>
            </details>
          )}
        </div>

        {/* Screenshot View (Right) */}
        <div className="w-full lg:w-[40%] xl:w-[45%] shrink-0 flex flex-col gap-2 border border-glass-border/30 rounded-xl p-3 bg-black/40">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Google Search Results Snapshot</span>
          
          {screenshotUrl ? (
            <div className="flex-1 rounded-lg overflow-hidden border border-glass-border/40 max-h-[350px] relative group cursor-zoom-in">
              <img
                src={screenshotUrl}
                alt="Google Search results"
                className="w-full h-full object-cover object-top hover:scale-[1.1] transition-all duration-300"
              />
              <span className="absolute bottom-2 right-2 px-2 py-1 bg-black/75 rounded text-[8px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Screenshot captured at search time
              </span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-glass-border rounded-lg text-gray-500 min-h-[200px]">
              <Loader2 size={32} className="animate-spin text-primary mb-2 text-amber-500" />
              <h5 className="text-[11px] font-semibold text-white">Google Search Discovery Active</h5>
              <p className="text-[10px] mt-1 text-gray-400">
                Searching Google and capturing search snippet snapshots... Please wait a few seconds.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CatalogUpload = () => {
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [hoveredHeader, setHoveredHeader] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Job States
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({
    total: 0,
    existing: 0,
    new: 0,
    duplicates: 0
  });
  
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  // History & List States
  const [previousJobs, setPreviousJobs] = useState<CatalogJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  
  // Messaging States
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Staged Reviews & Google Extraction States
  const [stagedReviews, setStagedReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [matchedPreviousJobId, setMatchedPreviousJobId] = useState<number | null>(null);
  const [newlyDetectedColumns, setNewlyDetectedColumns] = useState<string[]>([]);
  const [googleSearchStatus, setGoogleSearchStatus] = useState<{ count: number; limit: number } | null>(null);
  const [isCaptchaActive, setIsCaptchaActive] = useState(false);
  const [captchaMedicine, setCaptchaMedicine] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<any | null>(null);
  const [activeReviewSubTab, setActiveReviewSubTab] = useState<'details' | 'staged'>('staged');
  const [reviewSearchTerm, setReviewSearchTerm] = useState('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');

  // Mapping States
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const [customColumns, setCustomColumns] = useState<string[]>([]);
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [showOnlyMapped, setShowOnlyMapped] = useState<boolean>(false);
  const [showExistingColor, setShowExistingColor] = useState<boolean>(true);
  const [showNewColor, setShowNewColor] = useState<boolean>(true);

  const initMappingModal = (mappings: Record<string, string>, headers: string[], preview: any[]) => {
    setFileHeaders(headers);
    setPreviewRows(preview);
    
    if (preview.length > 0) {
      setPreviewHeaders(Object.keys(preview[0]));
    } else if (headers.length > 0) {
      setPreviewHeaders(headers);
    } else {
      setPreviewHeaders([]);
    }
    
    setColumnMappings(mappings);
    
    // Initialize custom columns
    const initialCustom = Object.values(mappings).filter((val: any) => typeof val === 'string' && val.startsWith('custom_col_')) as string[];
    setCustomColumns(Array.from(new Set(initialCustom)));
    
    // Initialize history
    setHistory([mappings]);
    setHistoryIndex(0);
    
    setShowMappingModal(true);
  };

  const updateMappingsWithHistory = (newMappings: Record<string, string>) => {
    setColumnMappings(newMappings);
    const newHistory = history.slice(0, historyIndex + 1);
    setHistory([...newHistory, newMappings]);
    setHistoryIndex(newHistory.length);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setColumnMappings(history[prevIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setColumnMappings(history[nextIndex]);
    }
  };

  const handleDeleteCustomColumn = (targetCol: string) => {
    if (window.confirm(`Are you sure you want to delete the custom column "${targetCol.replace('custom_col_', '')}"? This will unmap any headers currently mapped to it.`)) {
      setCustomColumns(prev => prev.filter(c => c !== targetCol));
      const updatedMappings = { ...columnMappings };
      Object.keys(updatedMappings).forEach(key => {
        if (updatedMappings[key] === targetCol) {
          updatedMappings[key] = '';
        }
      });
      updateMappingsWithHistory(updatedMappings);
    }
  };

  // Helper to fetch staged reviews for a catalog job
  const fetchReviews = useCallback(async (id: number) => {
    setLoadingReviews(true);
    try {
      const res = await api.getCatalogJobReviews(id);
      if (res.success) {
        setStagedReviews(res.reviews || []);
      }
    } catch (err) {
      console.error('Failed to fetch staged reviews:', err);
    } finally {
      setLoadingReviews(false);
    }
  }, []);

  // Helper to fetch Google Search rate limits and counters
  const fetchSearchStatus = useCallback(async () => {
    try {
      const res = await api.getGoogleSearchStatus();
      if (res.success) {
        setGoogleSearchStatus({ count: res.count, limit: res.limit });
      }
    } catch (err) {
      console.error('Failed to fetch search usage status:', err);
    }
  }, []);

  // Fetch previous jobs
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const jobs = await api.getCatalogJobs();
      setPreviousJobs(jobs || []);
      fetchSearchStatus();
    } catch (err: any) {
      console.error('Failed to fetch catalog jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  }, [fetchSearchStatus]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const jobIdRef = useRef<number | null>(null);
  useEffect(() => {
    jobIdRef.current = jobId;
    if (jobId) {
      fetchReviews(jobId);
    }
  }, [jobId, fetchReviews]);

  useEffect(() => {
    const backendUrl = apiClient.defaults.baseURL || window.location.origin;
    const cleanBaseUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
    const sseUrl = cleanBaseUrl.startsWith('/api')
      ? `${cleanBaseUrl}/notifications/stream`
      : `${cleanBaseUrl}/api/notifications/stream`;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      eventSource = new EventSource(sseUrl);

      eventSource.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);
          const { type, payload } = eventData;

          if (type === 'catalog_job_progress' && payload) {
            // Update active job progress if it matches
            if (payload.id === jobIdRef.current) {
              setProgress(payload.progress);
              if (payload.status) {
                setJobStatus(payload.status);
              }
              if (payload.total_count !== undefined) {
                setStats(prev => ({
                  total: payload.total_count,
                  existing: payload.existing_count || 0,
                  new: payload.new_count || 0,
                  duplicates: payload.duplicate_count || 0
                }));
              }
            }
            // Update previousJobs list item progress
            setPreviousJobs(prev => 
              prev.map(job => 
                job.id === payload.id 
                  ? { 
                      ...job, 
                      status: payload.status || job.status,
                      progress: payload.progress,
                      total_count: payload.total_count !== undefined ? payload.total_count : job.total_count,
                      new_count: payload.new_count !== undefined ? payload.new_count : job.new_count,
                      existing_count: payload.existing_count !== undefined ? payload.existing_count : job.existing_count,
                      duplicate_count: payload.duplicate_count !== undefined ? payload.duplicate_count : job.duplicate_count
                    } 
                  : job
              )
            );
          } else if (type === 'catalog_job_update' && payload) {
            // Update active job status/progress if it matches
            if (payload.id === jobIdRef.current) {
              setProgress(payload.progress !== undefined ? payload.progress : 0);
              setJobStatus(payload.status);

              if (payload.total_count !== undefined) {
                setStats(prev => ({
                  total: payload.total_count,
                  existing: payload.existing_count || 0,
                  new: payload.new_count || 0,
                  duplicates: payload.duplicate_count || 0
                }));
              }

              if (payload.status === 'done') {
                setImporting(false);
                setUploading(false);
                setJobId(null);
                setJobStatus(null);
                setPreviewRows([]);
                setSuccess(`Success! Imported catalogue products are now fully integrated and searchable.`);
              } else if (payload.status === 'failed') {
                setImporting(false);
                setJobStatus('failed');
                setError(payload.error || 'Ingestion failed.');
              } else if (payload.status === 'waiting_for_mapping') {
                setUploading(false);
                api.getCatalogJobStatus(payload.id).then(data => {
                  const headers = Array.isArray(data.headers) && data.headers.length > 0 ? data.headers : [];
                  const preview = Array.isArray(data.previewData) ? data.previewData : [];
                  initMappingModal(data.suggestedMapping || {}, headers, preview);
                }).catch(err => {
                  console.error('Failed to load mapping details:', err);
                  setError('Failed to load mapping details.');
                });
              }
            }
            
            // Update previousJobs list item status/progress
            setPreviousJobs(prev => 
              prev.map(job => 
                job.id === payload.id 
                  ? { 
                      ...job, 
                      status: payload.status, 
                      progress: payload.progress !== undefined ? payload.progress : job.progress,
                      error_log: payload.error || job.error_log,
                      total_count: payload.total_count !== undefined ? payload.total_count : job.total_count,
                      new_count: payload.new_count !== undefined ? payload.new_count : job.new_count,
                      existing_count: payload.existing_count !== undefined ? payload.existing_count : job.existing_count,
                      duplicate_count: payload.duplicate_count !== undefined ? payload.duplicate_count : job.duplicate_count
                    } 
                  : job
              )
            );

            // Fetch latest jobs to refresh stats and details
            fetchJobs();
          } else if (type === 'catalog_review_updated' && payload) {
            if (payload.jobId === jobIdRef.current) {
              fetchReviews(payload.jobId);
            }
          } else if (type === 'google_verification_required' && payload) {
            setIsCaptchaActive(true);
            setCaptchaMedicine(payload.medicineName);
          } else if (type === 'google_verification_solved' && payload) {
            setIsCaptchaActive(false);
            setCaptchaMedicine(null);
            if (jobIdRef.current) {
              fetchReviews(jobIdRef.current);
            }
          }
        } catch (err) {
          console.error('Failed to parse catalog SSE message:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.warn('Catalog SSE disconnected or failed, retrying in 5 seconds...', err);
        eventSource?.close();
        eventSource = null;
        reconnectTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [fetchJobs]);

  useEffect(() => {
    if (hoveredHeader && scrollContainerRef.current) {
      const thElement = scrollContainerRef.current.querySelector(
        `th[data-header="${CSS.escape(hoveredHeader)}"]`
      );
      if (thElement) {
        thElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [hoveredHeader]);

  // Handle file uploading
  const handleUpload = async (file: File) => {
    if (!file) return;
    setError(null);
    setSuccess(null);
    setUploading(true);
    setJobStatus('pending_analysis');
    setProgress(0);
    setPreviewRows([]);
    setJobId(null);
    setMatchedPreviousJobId(null);
    setNewlyDetectedColumns([]);
    
    try {
      const res = await api.uploadCatalogFile(file);
      if (res.success && res.jobId) {
        setJobId(res.jobId);
        setJobStatus(res.status || 'pending_analysis');
      } else {
        throw new Error(res.message || 'Upload failed');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || 'Failed to upload catalogue file');
      setUploading(false);
      setJobStatus(null);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files[0]);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => {
    setIsDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  // Trigger background batch import
  const handleIngestImport = async () => {
    if (!jobId) return;
    setError(null);
    setSuccess(null);
    setImporting(true);
    setJobStatus('processing');
    setProgress(0);
    
    try {
      const res = await api.importCatalogJob(jobId);
      if (res.success) {
        setSuccess('Background ingestion started successfully.');
      } else {
        throw new Error(res.message || 'Failed to trigger import');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || 'Failed to initiate batch import');
      setImporting(false);
      setJobStatus(null);
    }
  };

  const handlePauseJob = async (id: number) => {
    try {
      await api.pauseCatalogJob(id);
      setSuccess(`Catalogue Ingestion Job #${id} paused.`);
      if (jobId === id) {
        setJobStatus('paused');
      }
      fetchJobs();
    } catch (err: any) {
      console.error('Pause failed:', err);
      setError(err.response?.data?.error || err.message || 'Failed to pause ingestion');
    }
  };

  const handleResumeJob = async (id: number) => {
    try {
      await api.resumeCatalogJob(id);
      setSuccess(`Catalogue Ingestion Job #${id} resumed.`);
      if (jobId === id) {
        setImporting(true);
        setJobStatus('processing');
      }
      fetchJobs();
    } catch (err: any) {
      console.error('Resume failed:', err);
      setError(err.response?.data?.error || err.message || 'Failed to resume ingestion');
    }
  };

  const handleDeleteJob = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this catalog import job? This will delete the uploaded file and all job statistics.")) {
      return;
    }
    try {
      await api.deleteCatalogJob(id);
      setSuccess(`Job #${id} deleted successfully.`);
      if (jobId === id) {
        setJobId(null);
        setJobStatus(null);
        setPreviewRows([]);
      }
      fetchJobs();
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || 'Failed to delete job');
    }
  };

  // Load a job from history for review
  const reviewJobFromHistory = async (job: CatalogJob) => {
    setError(null);
    setSuccess(null);
    setUploading(true);
    setJobId(job.id);
    setJobStatus(job.status);
    setProgress(job.progress || 0);
    setStats({
      total: job.total_count || 0,
      existing: job.existing_count || 0,
      new: job.new_count || 0,
      duplicates: job.duplicate_count || 0
    });
    setMatchedPreviousJobId(null);
    setNewlyDetectedColumns([]);

    try {
      const data = await api.getCatalogJobStatus(job.id);
      if (data.previewData && data.previewData.length > 0) {
        setPreviewHeaders(Object.keys(data.previewData[0]));
        setPreviewRows(data.previewData);
      }
      if (data.matchedPreviousJobId) {
        setMatchedPreviousJobId(data.matchedPreviousJobId);
      }
      if (data.newlyDetectedColumns) {
        setNewlyDetectedColumns(data.newlyDetectedColumns);
      }
      setUploading(false);
      setActiveTab('upload');
      setSuccess(`Viewing review for Catalogue Job #${job.id}.`);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load catalogue preview details.');
      setUploading(false);
    }
  };

  return (
    <div className="h-full flex flex-col fade-in relative overflow-y-auto pb-12">
      <div className="glass-panel flex-1 flex flex-col overflow-hidden m-6 rounded-xl border border-glass-border">
        {/* Header Section */}
        <div className="p-6 border-b border-glass-border flex flex-col gap-3 bg-white/5">
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <h3 className="font-bold flex items-center gap-2 text-2xl text-white">
                <Database size={24} className="text-primary" /> 
                Catalogue Manager
              </h3>
              <p className="text-gray-400 text-sm mt-1">Upload and ingest huge product catalogue databases (100–200 MB+) in the background without locking or freezing the system.</p>
              

            </div>
            
            {/* Tabs */}
            <div className="flex bg-black/40 border border-glass-border p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${activeTab === 'upload' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <Upload size={14} /> Upload & Ingest
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${activeTab === 'history' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <History size={14} /> Import Jobs
              </button>
            </div>
          </div>
        </div>

        {/* Success & Error Banners */}
        {error && (
          <div className="mx-6 mt-4 p-4 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl flex items-start gap-3 text-sm">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold">Error Processing Catalogue:</span>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 p-4 bg-green-500/10 text-green-400 border border-green-500/20 rounded-xl flex items-center gap-3 text-sm">
            <CheckCircle size={18} className="shrink-0" />
            <span className="font-semibold">{success}</span>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-hidden flex flex-col">
          {activeTab === 'upload' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Dropzone */}
              {!jobId && !uploading && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <label
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    className={`bg-white/5 border-2 border-dashed rounded-xl p-12 max-w-lg w-full cursor-pointer transition-all ${isDragOver ? 'border-primary bg-primary/5' : 'border-glass-border hover:border-primary/50'}`}
                  >
                    <Upload size={48} className="mx-auto text-gray-500 mb-4" />
                    <h4 className="text-lg font-semibold text-white mb-2">Upload Catalogue File</h4>
                    <p className="text-gray-400 text-sm mb-6">Select or drag catalogue CSV, PDF, or Excel database to scan (Supports 100MB+ files)</p>
                    <div className="premium-btn bg-primary text-white pointer-events-none">
                      Select Catalogue File
                    </div>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls,.pdf"
                      onChange={onFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* Uploading or Scanning / Pre-scan Phase */}
              {uploading && !importing && (
                <div className="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto">
                  <Loader2 size={48} className="animate-spin text-primary mb-4" />
                  <h4 className="text-lg font-semibold text-white mb-2">
                    {jobStatus === 'pending_analysis' && 'Uploading database...'}
                    {jobStatus === 'processing_analysis' && 'Analyzing file schema and extracting data...'}
                    {jobStatus === 'pending' && 'Analyzing file schema...'}
                    {jobStatus === 'processing' && 'Pre-scanning and compiling statistics...'}
                    {!jobStatus && 'Uploading database...'}
                  </h4>
                  {stats.total > 0 && jobStatus === 'processing_analysis' && (
                    <p className="text-xs text-primary mb-2 font-semibold animate-pulse">
                      Scanned {stats.total.toLocaleString()} rows so far...
                    </p>
                  )}
                  <p className="text-gray-400 text-sm mb-4">
                    The background worker is parsing your file. You can safely navigate away and continue working; you will be notified when mapping is ready.
                  </p>
                  <div className="w-full bg-white/5 rounded-full h-2 mt-2">
                    <div className="bg-primary h-2 rounded-full animate-pulse w-3/4" />
                  </div>
                </div>
              )}

              {/* Importing Ingestion Phase */}
              {importing && (
                <div className="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto">
                  {jobStatus === 'paused' ? (
                    <Loader2 size={48} className="text-amber-500 mb-4" />
                  ) : (
                    <RefreshCw size={48} className="animate-spin text-green mb-4" />
                  )}
                  <h4 className="text-lg font-semibold text-white mb-2">
                    {jobStatus === 'paused' ? `Ingestion Paused: ${progress}%` : `Ingesting catalogue: ${progress}% Complete`}
                  </h4>
                  {stats.total > 0 && (
                    <p className="text-xs text-gray-400 mb-2 font-semibold">
                      Ingested {((stats.new || 0) + (stats.existing || 0) + (stats.duplicates || 0)).toLocaleString()} / {stats.total.toLocaleString()} products
                    </p>
                  )}
                  <p className="text-gray-400 text-sm mb-4">
                    Processing products in transactional batches of 1,000 to keep memory low and prevent locks.
                  </p>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-white/5 rounded-full h-4 relative overflow-hidden border border-glass-border">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ease-out ${jobStatus === 'paused' ? 'bg-amber-500' : 'bg-green'}`} 
                      style={{ width: `${progress}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                      {progress}%
                    </span>
                  </div>

                  {stats.total > 0 && (
                    <div className="grid grid-cols-3 gap-3 w-full mt-6">
                      <div className="bg-black/30 border border-glass-border/40 rounded p-3 flex flex-col items-center">
                        <span className="text-xl font-bold text-emerald-400">{stats.new}</span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">New Products</span>
                      </div>
                      <div className="bg-black/30 border border-glass-border/40 rounded p-3 flex flex-col items-center">
                        <span className="text-xl font-bold text-blue-400">{stats.existing}</span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">Updated</span>
                      </div>
                      <div className="bg-black/30 border border-glass-border/40 rounded p-3 flex flex-col items-center">
                        <span className="text-xl font-bold text-amber-400">{stats.duplicates}</span>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">Duplicates Skipped</span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 mt-6">
                    {jobStatus === 'processing' || jobStatus === 'pending' ? (
                      <button
                        onClick={() => handlePauseJob(jobId!)}
                        className="bg-amber-500 hover:bg-amber-600 text-black text-xs font-bold px-6 py-2.5 rounded-xl shadow-lg transition-all"
                      >
                        Pause Ingestion
                      </button>
                    ) : jobStatus === 'paused' ? (
                      <button
                        onClick={() => handleResumeJob(jobId!)}
                        className="bg-green hover:bg-green/90 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-lg transition-all flex items-center gap-1.5"
                      >
                        <Play size={13} /> Resume Ingestion
                      </button>
                    ) : null}
                  </div>

                  <p className="text-[10px] text-gray-500 mt-4">
                    You can safely close this screen or continue recording sales/bills while import runs in the background.
                  </p>
                </div>
              )}

              {/* Scan Results & Review Screen */}
              {jobId && !uploading && !importing && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <div>
                      <h4 className="text-lg font-semibold text-white">Catalogue Analysis Results</h4>
                      <p className="text-xs text-gray-400">Review results below. Products will be created or merged on confirm.</p>
                    </div>

                    <div className="flex items-center gap-3">
                      {jobStatus === 'ready_for_review' && (
                        <button
                          onClick={handleIngestImport}
                          className="premium-btn bg-green text-white hover:opacity-90 flex items-center gap-1.5 text-xs font-bold shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                        >
                          <Play size={13} /> Start Ingestion
                        </button>
                      )}
                      
                      {(jobStatus === 'waiting_for_mapping' || jobStatus === 'ready_for_review' || jobStatus === 'done' || jobStatus === 'failed') && (
                        <button
                          onClick={async () => {
                            if (!jobId) return;
                            try {
                              const data = await api.getCatalogJobStatus(jobId);
                              const headers = Array.isArray(data.headers) && data.headers.length > 0 ? data.headers : [];
                              const preview = Array.isArray(data.previewData) ? data.previewData : [];
                              initMappingModal(data.mappingConfig || data.suggestedMapping || {}, headers, preview);
                            } catch (err) {
                              console.error('Configure Mappings Error:', err);
                              setError('Failed to load mapping details.');
                            }
                          }}
                          className="text-xs bg-amber-500 hover:bg-amber-600 text-black px-4 py-2 rounded-xl font-bold transition-all shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                        >
                          Configure Mappings
                        </button>
                      )}

                      <button
                        onClick={() => { setJobId(null); setJobStatus(null); setPreviewRows([]); }}
                        className="bg-white/5 border border-glass-border hover:bg-white/10 px-4 py-2 rounded-xl text-xs font-bold text-gray-400 transition-all"
                      >
                        Upload Another
                      </button>

                      {jobId && (
                        <button
                          onClick={() => handleDeleteJob(jobId)}
                          className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 px-4 py-2 rounded-xl text-xs font-bold text-red-400 transition-all"
                        >
                          Delete Job
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Duplicate Catalog Alert Banner */}
                  {matchedPreviousJobId && (
                    <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl flex flex-col gap-2">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <AlertTriangle size={18} className="text-amber-500" />
                        <span>Duplicate Catalog Detected</span>
                      </div>
                      <p className="text-xs text-muted">
                        This catalog matches a previously uploaded catalog (Job ID: <span className="font-bold text-white">#{matchedPreviousJobId}</span>).
                      </p>
                      {newlyDetectedColumns.length > 0 ? (
                        <div className="text-xs mt-1 flex items-center gap-2">
                          <span className="font-semibold text-white">Newly detected columns:</span>
                          <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-mono border border-blue-500/30">
                            {newlyDetectedColumns.join(', ')}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs mt-1 text-muted">No new columns detected in this upload.</p>
                      )}
                    </div>
                  )}

                  {/* Processing Summary Dashboard (8 Stats) */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-bg2 border border-border p-4 rounded-xl text-center flex flex-col justify-center">
                      <p className="text-2xl font-black text-text">{stats.total.toLocaleString()}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">Total Uploaded</p>
                    </div>
                    
                    <div 
                      onClick={() => setShowNewColor(p => !p)}
                      className={`bg-bg2 border border-border p-4 rounded-xl text-center cursor-pointer select-none hover:scale-[1.02] transition-transform ${showNewColor ? 'bg-bg3 border-green/30' : 'opacity-65'}`}
                    >
                      <p className="text-2xl font-black text-green">{stats.new.toLocaleString()}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">New Medicines</p>
                      <span className={`text-[8px] font-bold uppercase tracking-wider mt-1.5 px-1.5 py-0.5 rounded-full inline-block border ${showNewColor ? 'bg-glass-bg border-glass-border text-green' : 'bg-bg border-glass-border text-muted'}`}>
                        {showNewColor ? 'Highlighted' : 'Muted'}
                      </span>
                    </div>

                    <div 
                      onClick={() => setShowExistingColor(p => !p)}
                      className={`bg-bg2 border border-border p-4 rounded-xl text-center cursor-pointer select-none hover:scale-[1.02] transition-transform ${showExistingColor ? 'bg-bg3 border-amber-500/30' : 'opacity-65'}`}
                    >
                      <p className="text-2xl font-black text-amber-500">{stats.existing.toLocaleString()}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">Existing Matched</p>
                      <span className={`text-[8px] font-bold uppercase tracking-wider mt-1.5 px-1.5 py-0.5 rounded-full inline-block border ${showExistingColor ? 'bg-glass-bg border-glass-border text-amber-500' : 'bg-bg border-glass-border text-muted'}`}>
                        {showExistingColor ? 'Highlighted' : 'Muted'}
                      </span>
                    </div>

                    <div className="bg-bg2 border border-border p-4 rounded-xl text-center flex flex-col justify-center">
                      <p className="text-2xl font-black text-red-400">{stats.duplicates.toLocaleString()}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">Duplicate Medicines</p>
                    </div>

                    <div className="bg-bg2 border border-border p-4 rounded-xl text-center flex flex-col justify-center">
                      <p className="text-2xl font-black text-amber-500">{stagedReviews.filter(r => r.status === 'pending').length}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">Requiring Review</p>
                    </div>

                    <div className="bg-bg2 border border-border p-4 rounded-xl text-center flex flex-col justify-center">
                      <p className="text-2xl font-black text-blue-400">{newlyDetectedColumns.length}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">New Columns</p>
                    </div>

                    <div className="bg-bg2 border border-border p-4 rounded-xl text-center flex flex-col justify-center">
                      <p className="text-2xl font-black text-green">{stagedReviews.filter(r => r.status === 'approved').length}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">Successfully Approved</p>
                    </div>

                    <div className="bg-bg2 border border-border p-4 rounded-xl text-center flex flex-col justify-center">
                      <p className="text-2xl font-black text-red-500">{stagedReviews.filter(r => r.status === 'rejected').length}</p>
                      <p className="text-[10px] text-muted font-bold uppercase tracking-wider mt-1">Rejected / Excluded</p>
                    </div>
                  </div>

                  {/* Tab Selector */}
                  <div className="flex border-b border-border mb-4">
                    <button
                      onClick={() => setActiveReviewSubTab('staged')}
                      className={`px-4 py-2 text-xs font-bold border-b-2 transition-all ${
                        activeReviewSubTab === 'staged'
                          ? 'border-primary text-text'
                          : 'border-transparent text-muted hover:text-text'
                      }`}
                    >
                      Preview Grid
                    </button>
                    <button
                      onClick={() => {
                        setActiveReviewSubTab('details');
                        if (jobId) fetchReviews(jobId);
                      }}
                      className={`px-4 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                        activeReviewSubTab === 'details'
                          ? 'border-primary text-text'
                          : 'border-transparent text-muted hover:text-text'
                      }`}
                    >
                      Review Queue ({stagedReviews.filter(r => r.status === 'pending').length} pending)
                    </button>
                  </div>

                  {/* Preview Grid Tab Content */}
                  {activeReviewSubTab === 'staged' && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <h5 className="font-bold text-xs text-gray-400 mb-2 uppercase tracking-wider">
                        Catalogue Preview (First 100 lines)
                      </h5>
                      <div className="flex-1 overflow-auto border border-glass-border/30 rounded-xl bg-black/20">
                        <table className="w-full text-left text-xs text-gray-300">
                          <thead className="sticky top-0 bg-[#18181b]/95 border-b border-glass-border">
                            <tr>
                              {previewHeaders.map((header) => (
                                <th key={header} className="p-3 font-bold uppercase tracking-wide text-gray-400">{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {previewRows.map((row, ri) => {
                              const isExisting = row.__is_existing === true;
                              let rowClass = "border-b border-glass-border/10 hover:bg-white/5 transition-all duration-200";
                              
                              if (isExisting) {
                                if (showExistingColor) {
                                  rowClass += " bg-amber-500/5 text-yellow-400/90";
                                }
                              } else {
                                if (showNewColor) {
                                  rowClass += " bg-emerald-500/5 text-green/90";
                                }
                              }

                              return (
                                <tr key={ri} className={rowClass}>
                                  {previewHeaders.map((header) => (
                                    <td key={header} className="p-3 max-w-xs truncate" title={row[header]}>
                                      {String(row[header] ?? '—')}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Review Queue Tab Content */}
                  {activeReviewSubTab === 'details' && (
                    <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
                      {/* Left Pane: Review Items List */}
                      <div className="w-full md:w-[30%] lg:w-[25%] shrink-0 border border-border rounded-xl bg-bg2 p-4 flex flex-col gap-3 overflow-hidden">
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            placeholder="Search reviews..."
                            value={reviewSearchTerm}
                            onChange={e => setReviewSearchTerm(e.target.value)}
                            className="w-full bg-black/40 border border-glass-border text-white text-xs rounded-lg p-2 outline-none focus:border-primary font-medium"
                          />
                          <select
                            value={reviewStatusFilter}
                            onChange={e => setReviewStatusFilter(e.target.value as any)}
                            className="w-full bg-black/40 border border-glass-border text-white text-xs rounded-lg p-2 outline-none focus:border-primary font-medium"
                          >
                            <option value="pending">Pending Review</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                            <option value="all">All Records</option>
                          </select>
                        </div>

                        {loadingReviews ? (
                          <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="animate-spin text-primary" size={20} />
                          </div>
                        ) : (
                          <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
                            {stagedReviews
                              .filter(r => {
                                const matchesSearch = r.medicine_name.toLowerCase().includes(reviewSearchTerm.toLowerCase());
                                const matchesFilter = 
                                  reviewStatusFilter === 'all' || 
                                  r.status === reviewStatusFilter;
                                return matchesSearch && matchesFilter;
                              })
                              .map((r) => {
                                const isSelected = selectedReview && selectedReview.id === r.id;
                                return (
                                  <button
                                    key={r.id}
                                    onClick={() => setSelectedReview(r)}
                                    className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${
                                      isSelected
                                        ? 'bg-primary/10 border-primary text-text shadow-[0_0_10px_rgba(59,130,246,0.15)]'
                                        : 'bg-bg border-glass-border text-muted hover:border-glass-border/80 hover:text-text'
                                    }`}
                                  >
                                    <span className="text-xs font-bold truncate block text-white">{r.medicine_name}</span>
                                    <div className="flex justify-between items-center w-full text-[9px] mt-1">
                                      <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase border ${
                                        r.status === 'approved' ? 'bg-green-500/10 text-green border-green/20' :
                                        r.status === 'rejected' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                        'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                      }`}>
                                        {r.status}
                                      </span>
                                      {r.screenshot_path && (
                                        <span className="text-green flex items-center gap-0.5 font-bold">
                                          ✓ Enriched
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            {stagedReviews.filter(r => {
                              const matchesSearch = r.medicine_name.toLowerCase().includes(reviewSearchTerm.toLowerCase());
                              const matchesFilter = reviewStatusFilter === 'all' || r.status === reviewStatusFilter;
                              return matchesSearch && matchesFilter;
                            }).length === 0 && (
                              <div className="text-center py-8 text-gray-500 text-xs italic">
                                No reviews found matching filters.
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right Pane: Review Detail Pane */}
                      <div className="flex-1 border border-border rounded-xl bg-bg2 p-5 overflow-y-auto">
                        {selectedReview ? (
                          <ReviewDetailPane
                            review={selectedReview}
                            googleSearchStatus={googleSearchStatus}
                            onApproved={() => {
                              if (jobId) {
                                fetchReviews(jobId);
                                fetchSearchStatus();
                                setSelectedReview(null);
                              }
                            }}
                            onRejected={() => {
                              if (jobId) {
                                fetchReviews(jobId);
                                setSelectedReview(null);
                              }
                            }}
                          />
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-500">
                            <FileText size={40} className="mb-2 text-gray-600" />
                            <h5 className="text-xs font-semibold text-white">Select a Medicine to Review</h5>
                            <p className="text-[11px] mt-1 max-w-xs text-muted">
                              Medicines missing composition references are staged here. Click one from the list to review, search Google, or manually approve.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* History Tab */
            <div className="flex-1 flex flex-col overflow-hidden">
              <h4 className="text-lg font-semibold text-white mb-4">Ingestion Jobs Log</h4>
              
              {loadingJobs ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 size={32} className="animate-spin text-primary" />
                </div>
              ) : previousJobs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500">
                  <Database size={40} className="mb-2 text-gray-600" />
                  <p className="text-sm">No catalogue ingestion records found.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto border border-glass-border/30 rounded-xl bg-black/20">
                  <table className="w-full text-left text-xs text-gray-300">
                    <thead className="sticky top-0 bg-[#18181b]/95 border-b border-glass-border">
                      <tr>
                        <th className="p-3">Job ID</th>
                        <th className="p-3">Catalogue File</th>
                        <th className="p-3">Created At</th>
                        <th className="p-3">Stats</th>
                        <th className="p-3">Progress</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previousJobs.map((job) => (
                        <tr key={job.id} className="border-b border-glass-border/20 hover:bg-white/5 transition-all">
                          <td className="p-3 font-semibold text-white">#{job.id}</td>
                          <td className="p-3 max-w-xs truncate font-semibold" title={job.file_path}>
                            {job.original_filename || job.file_path.split('\\').pop()?.split('/').pop() || 'Unknown File'}
                          </td>
                          <td className="p-3 text-gray-400">
                            {new Date(job.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 text-gray-400">
                            {job.total_count ? (
                              <div className="text-[10px] space-y-0.5">
                                <div>Total: <span className="font-bold text-white">{job.total_count.toLocaleString()}</span></div>
                                <div className="flex gap-2">
                                  <span className="text-green">New: {job.new_count?.toLocaleString() || 0}</span>
                                  <span>|</span>
                                  <span className="text-yellow-400">Exist: {job.existing_count?.toLocaleString() || 0}</span>
                                  <span>|</span>
                                  <span className="text-red-400">Dup: {job.duplicate_count?.toLocaleString() || 0}</span>
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              {job.status === 'processing_analysis' ? (
                                <span className="text-[9px] text-primary font-medium animate-pulse">
                                  Analyzing: {job.total_count?.toLocaleString() || 0} rows scanned
                                </span>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 bg-white/5 h-1.5 rounded-full overflow-hidden border border-glass-border">
                                      <div 
                                        className={`h-full rounded-full ${job.status === 'paused' ? 'bg-amber-500' : 'bg-primary'}`} 
                                        style={{ width: `${job.progress || 0}%` }}
                                      />
                                    </div>
                                    <span className="text-[9px] font-bold text-gray-400">{job.progress || 0}%</span>
                                  </div>
                                  {job.total_count ? (
                                    <span className="text-[9px] text-gray-500 font-medium">
                                      {((job.new_count || 0) + (job.existing_count || 0) + (job.duplicate_count || 0)).toLocaleString()} / {job.total_count.toLocaleString()} rows
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              job.status === 'done' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                              job.status === 'processing' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                              job.status === 'ready_for_review' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                              job.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                              job.status === 'waiting_for_mapping' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                              job.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                              'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}>
                              {job.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {(job.status === 'processing' || job.status === 'pending') && (
                              <button
                                onClick={() => handlePauseJob(job.id)}
                                className="text-xs bg-amber-500 hover:bg-amber-600 text-black px-3 py-1 rounded-lg font-bold transition-all mr-2"
                              >
                                Pause
                              </button>
                            )}
                            {job.status === 'paused' && (
                              <button
                                onClick={() => handleResumeJob(job.id)}
                                className="text-xs bg-green hover:bg-green/90 text-white px-3 py-1 rounded-lg font-bold transition-all mr-2 flex inline-flex items-center gap-1"
                              >
                                <Play size={10} /> Resume
                              </button>
                            )}
                            {(job.status === 'waiting_for_mapping' || job.status === 'ready_for_review' || job.status === 'done' || job.status === 'failed') && (
                              <button
                                onClick={async () => {
                                  setError(null);
                                  setSuccess(null);
                                  setJobId(job.id);
                                  setJobStatus(job.status);
                                  try {
                                    const data = await api.getCatalogJobStatus(job.id);
                                    const headers = Array.isArray(data.headers) && data.headers.length > 0 ? data.headers : [];
                                    const preview = Array.isArray(data.previewData) ? data.previewData : [];
                                    initMappingModal(data.mappingConfig || data.suggestedMapping || {}, headers, preview);
                                  } catch (err) {
                                    console.error('Configure Mappings Error:', err);
                                    setError('Failed to load mapping details.');
                                  }
                                }}
                                className="text-xs bg-amber-500 hover:bg-amber-600 text-black px-3 py-1 rounded-lg font-bold transition-all mr-2"
                              >
                                Configure Mappings
                              </button>
                            )}
                            {(job.status === 'ready_for_review' || job.status === 'done') && (
                              <button
                                onClick={() => reviewJobFromHistory(job)}
                                className="text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 px-3 py-1 rounded-lg font-bold transition-all"
                              >
                                Review / Import
                              </button>
                            )}
                            {job.status !== 'processing' && job.status !== 'pending' && (
                              <button
                                onClick={() => handleDeleteJob(job.id)}
                                className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 px-3 py-1 rounded-lg font-bold transition-all ml-2"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mapping Preview Popup */}
      {showMappingModal && createPortal(
        (() => {
          const visibleHeaders = fileHeaders.filter(h => {
            if (showOnlyMapped) {
              return columnMappings[h] && columnMappings[h] !== '';
            }
            return true;
          });

          return (
            <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-3">
              <div className="glass-panel w-full max-w-[99vw] h-[98vh] lg:max-w-[98vw] lg:h-[95vh] flex flex-col rounded-2xl border border-glass-border shadow-2xl overflow-hidden bg-zinc-950">
                {/* Modal Header */}
                <div className="p-4 md:px-6 md:py-4 border-b border-glass-border bg-white/5 flex justify-between items-center">
                  <div>
                    <h4 className="text-lg font-bold text-white flex items-center gap-2">
                      <Database size={20} className="text-primary" />
                      Catalogue Column Mapping & Configuration
                    </h4>
                    <p className="text-gray-400 text-xs mt-1">
                      Map the columns from your uploaded file to the pharmacy catalog fields. Product Name is required.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowMappingModal(false);
                    }}
                    className="text-gray-400 hover:text-white transition-colors text-sm font-bold bg-white/10 px-3 py-1.5 rounded-lg border border-white/10"
                  >
                    Cancel
                  </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                  {/* Left Column: Mappings form */}
                  <div className="w-full lg:w-[48%] xl:w-[50%] p-4 md:p-5 overflow-y-auto border-b lg:border-b-0 lg:border-r border-glass-border flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Configure Column Mappings</h5>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const updatedMappings = { ...columnMappings };
                            fileHeaders.forEach(h => {
                              if (!updatedMappings[h]) {
                                updatedMappings[h] = '';
                              }
                            });
                            updateMappingsWithHistory(updatedMappings);
                          }}
                          className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-glass-border text-gray-300 text-[10px] font-bold rounded-lg transition-all"
                          title="Set all unmapped columns to Ignore"
                        >
                          Ignore Unused Columns
                        </button>
                        
                        {/* Undo / Redo controls */}
                        <div className="flex items-center gap-2 bg-black/40 p-1 rounded-lg border border-glass-border">
                        <button
                          onClick={handleUndo}
                          disabled={historyIndex <= 0}
                          className="p-1 px-2 text-[10px] font-bold rounded hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-white transition-colors"
                          title="Undo Mapping Change"
                        >
                          Undo
                        </button>
                        <div className="w-px h-3 bg-glass-border" />
                        <button
                          onClick={handleRedo}
                          disabled={historyIndex >= history.length - 1}
                          className="p-1 px-2 text-[10px] font-bold rounded hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-white transition-colors"
                          title="Redo Mapping Change"
                        >
                          Redo
                        </button>
                      </div>
                    </div>
                  </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {fileHeaders.map((header) => {
                        const currentMapping = columnMappings[header] || '';
                        const sampleValue = previewRows[0]?.[header] || '—';

                        const isCustomMapping = currentMapping.startsWith('custom_col_');
                        const customFieldName = isCustomMapping ? currentMapping.substring(11) : '';

                        return (
                          <div 
                            key={header} 
                            onMouseEnter={() => setHoveredHeader(header)}
                            onMouseLeave={() => setHoveredHeader(null)}
                            className={`p-3 rounded-lg border transition-all flex flex-col gap-2 ${
                              hoveredHeader === header
                                ? 'border-primary bg-white/10 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                                : 'border-glass-border/60 bg-white/5 hover:bg-white/10 hover:border-primary/40'
                            }`}
                          >
                            <div className="flex flex-col gap-1 min-w-0">
                              <span className="text-xs font-bold text-white truncate block" title={header}>
                                {header}
                              </span>
                              <span className="text-[10px] text-gray-400 bg-black/40 px-1.5 py-0.5 rounded border border-glass-border/30 truncate self-start block max-w-full font-medium" title={String(sampleValue)}>
                                Sample: <span className="text-primary font-mono">{String(sampleValue)}</span>
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-1.5 w-full">
                              <select
                                value={currentMapping}
                                onFocus={() => setHoveredHeader(header)}
                                onBlur={() => setHoveredHeader(null)}
                                onChange={(e) => {
                                  if (e.target.value === 'CREATE_CUSTOM') {
                                    const colName = window.prompt("Enter new custom database column name:");
                                    if (colName) {
                                      const cleanName = colName.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                                      if (cleanName) {
                                        const customVal = `custom_col_${cleanName}`;
                                        if (!customColumns.includes(customVal)) {
                                          setCustomColumns(prev => [...prev, customVal]);
                                        }
                                        const newMappings = { ...columnMappings, [header]: customVal };
                                        updateMappingsWithHistory(newMappings);
                                      }
                                    }
                                  } else {
                                    const newMappings = { ...columnMappings, [header]: e.target.value };
                                    updateMappingsWithHistory(newMappings);
                                  }
                                }}
                                className="flex-1 bg-black/60 border border-glass-border/60 text-white text-xs rounded-lg p-2 outline-none focus:border-primary transition-all cursor-pointer font-medium"
                              >
                                <option value="">-- Ignore --</option>
                                {AVAILABLE_DB_SECTIONS.map((section) => (
                                  <optgroup key={section.label} label={section.label} className="bg-[#18181b] text-primary font-semibold">
                                    {section.fields.map((f) => (
                                      <option key={f.value} value={f.value} className="bg-[#18181b] text-white font-normal">
                                        {f.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                                
                                {/* Render Created Custom Columns */}
                                {customColumns.length > 0 && (
                                  <optgroup label="✨ Created Custom Columns" className="bg-[#18181b] text-blue-400 font-semibold">
                                    {customColumns.map((c) => (
                                      <option key={c} value={c} className="bg-[#18181b] text-white font-normal">
                                        Custom Field: {c.substring(11)}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                
                                <option value="CREATE_CUSTOM" className="bg-[#18181b] text-yellow-500 font-semibold">
                                  + Add Custom Column...
                                </option>
                              </select>

                              {isCustomMapping && (
                                <button
                                  onClick={() => handleDeleteCustomColumn(currentMapping)}
                                  className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg transition-colors shrink-0"
                                  title="Delete Custom Column Mapping"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Sample Data Preview (First 100 Rows) */}
                  <div className="w-full lg:w-[52%] xl:w-[50%] p-4 md:p-5 flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center mb-3">
                      <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sample Data Grid (First 100 Rows)</h5>
                      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-white select-none">
                        <input
                          type="checkbox"
                          checked={showOnlyMapped}
                          onChange={(e) => setShowOnlyMapped(e.target.checked)}
                          className="rounded border-glass-border bg-black/60 text-primary focus:ring-0 focus:ring-offset-0 focus:outline-none"
                        />
                        Show Mapped Columns Only
                      </label>
                    </div>
                    
                    <div ref={scrollContainerRef} className="flex-1 overflow-auto border border-glass-border rounded-xl bg-black/40">
                      <table className="min-w-full divide-y divide-glass-border text-xs text-left">
                        <thead className="bg-[#18181b]/90 sticky top-0 z-10">
                          <tr>
                            {visibleHeaders.map((header) => {
                              const isMapped = columnMappings[header];
                              const customFieldName = isMapped && isMapped.startsWith('custom_col_') ? isMapped.substring(11) : '';
                              const fieldInfo = isMapped ? (customFieldName ? { section: 'Custom Column', label: customFieldName } : getFieldLabelAndSection(isMapped)) : null;
                              const styles = getHighlightStyles(isMapped || '', hoveredHeader === header);
                              return (
                                <th 
                                  key={header} 
                                  data-header={header}
                                  onMouseEnter={() => setHoveredHeader(header)}
                                  onMouseLeave={() => setHoveredHeader(null)}
                                  className={`px-4 py-3 font-bold border-b border-glass-border transition-all duration-150 truncate whitespace-nowrap cursor-pointer ${styles.header}`}
                                >
                                  {header}
                                  {isMapped && fieldInfo && (
                                    <span className="block text-[10px] font-bold mt-1 flex flex-wrap items-center gap-1">
                                      <span className={`px-1.5 py-0.5 rounded border text-[8px] uppercase ${
                                        customFieldName ? 'bg-blue-400/10 text-blue-300 border-blue-400/20' : 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20'
                                      }`}>{fieldInfo.section}</span>
                                      <span className="truncate max-w-[120px]">{fieldInfo.label}</span>
                                    </span>
                                  )}
                                </th>
                              );
                            })}
                            {visibleHeaders.length === 0 && (
                              <th className="px-4 py-3 font-normal text-gray-500 italic border-b border-glass-border">No columns found.</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-glass-border/40 text-gray-300 font-mono">
                          {previewRows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-white/5 transition-colors">
                              {visibleHeaders.map((header) => {
                                const isMapped = columnMappings[header];
                                const styles = getHighlightStyles(isMapped || '', hoveredHeader === header);
                                return (
                                  <td 
                                    key={header} 
                                    onMouseEnter={() => setHoveredHeader(header)}
                                    onMouseLeave={() => setHoveredHeader(null)}
                                    className={`px-4 py-2 truncate max-w-[200px] transition-all duration-150 ${styles.cell}`} 
                                    title={row[header]}
                                  >
                                    {row[header] !== undefined ? String(row[header]) : ''}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="p-6 border-t border-glass-border bg-white/5 flex justify-between items-center">
                  <div className="text-xs text-gray-400 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-500 animate-pulse" />
                    <span>Mappings are learned to auto-suggest in subsequent file uploads.</span>
                  </div>
                  
                  <button
                    onClick={async () => {
                      // Validate Product Name (required) is mapped
                      const nameMapped = Object.values(columnMappings).includes('name');
                      if (!nameMapped) {
                        alert('Error: You must map at least one column to the "Product Name (Required)" target field.');
                        return;
                      }
                      
                      // Start ingestion
                      if (!jobId) return;
                      setError(null);
                      setSuccess(null);
                      setImporting(true);
                      setJobStatus('processing');
                      setProgress(0);
                      setShowMappingModal(false);
                      setActiveTab('upload');
                      
                      try {
                        const res = await api.importCatalogJob(jobId, columnMappings, {});
                        if (res.success) {
                          setSuccess('Mapping confirmed. Background ingestion started successfully.');
                        } else {
                          throw new Error(res.message || 'Ingestion trigger failed');
                        }
                      } catch (err: any) {
                        setError(err.response?.data?.error || err.message || 'Failed to trigger ingestion');
                        setImporting(false);
                        setJobStatus(null);
                      }
                    }}
                    className="bg-primary hover:bg-primary/90 text-white text-xs font-bold px-6 py-3 rounded-lg flex items-center gap-2 shadow-lg hover:shadow-primary/20 transition-all"
                  >
                    <Play size={14} /> Confirm & Start Ingestion
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {isCaptchaActive && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border p-6 rounded-2xl max-w-md w-full shadow-2xl flex flex-col items-center text-center gap-4 animate-pulse">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-full flex items-center justify-center">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-lg font-bold text-white">Google Verification Required</h3>
            <p className="text-xs text-muted">
              Google has triggered a CAPTCHA challenge for medicine composition search:
              <span className="block font-bold text-white mt-1 text-sm bg-black/40 p-2 rounded border border-border/30">
                "{captchaMedicine || 'Active Medicine'}"
              </span>
            </p>
            <div className="bg-amber-500/5 border border-amber-500/20 text-amber-300 text-[11px] p-3 rounded-lg text-left">
              <strong>How to solve:</strong>
              <ol className="list-decimal list-inside space-y-1 mt-1 text-[10px] text-muted">
                <li>A headful Chrome browser window has been opened on your local server.</li>
                <li>Please locate that window and solve the CAPTCHA challenge manually.</li>
                <li>Once solved, the system will automatically detect the result and resume.</li>
              </ol>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <Loader2 size={12} className="animate-spin text-amber-500" />
              <span>Waiting for CAPTCHA resolution...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogUpload;
