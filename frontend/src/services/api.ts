import axios from 'axios';

// Vite handles the proxy in dev mode to http://localhost:3000
const API_URL = '/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to attach the session token if available
apiClient.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('session_token') || localStorage.getItem('api_key');
    if (token) {
      config.headers['x-session-token'] = token;
    }
  } catch (err) {
    console.warn('localStorage access denied. Token not attached.');
  }
  return config;
});

// Utility for API Data Standardization (snake_case -> camelCase)
// This is the implementation of the missing data standardizer layer
// DO NOT globally enable this interceptor yet as it will break 432+ legacy UI elements.
// Instead, new modules should use `apiClient.get('/path', { standardizeData: true })`
export const toCamelCase = (str: string): string => {
  return str.replace(/([-_][a-z])/ig, ($1) => {
    return $1.toUpperCase()
      .replace('-', '')
      .replace('_', '');
  });
};

export const objectToCamelCase = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => objectToCamelCase(item));
  }
  
  return Object.keys(obj).reduce((result, key) => {
    const camelKey = toCamelCase(key);
    result[camelKey] = objectToCamelCase(obj[key]);
    return result;
  }, {} as Record<string, any>);
};

// Extend Axios request config to support standardization flag
declare module 'axios' {
  export interface AxiosRequestConfig {
    standardizeData?: boolean;
  }
}

// Interceptor to handle errors centrally and OPTIONAL data standardization
apiClient.interceptors.response.use(
  (response) => {
    // Check if the caller opted into data standardization
    if (response.config && response.config.standardizeData && response.data) {
      response.data = objectToCamelCase(response.data);
    }
    return response;
  },
  (error) => {
    // Basic global error handling
    if (error.response?.status === 401) {
      console.warn('Unauthorized request. Token might be missing or invalid.');
    }
    return Promise.reject(error);
  }
);

// Define API interface types here as needed
export interface DashboardStats {
  todaySales: number;
  lowStock: number;
  pendingTasks: number;
  alerts?: Array<{
    id: number;
    description: string;
    created_at: string;
  }>;
}

export interface Medicine {
  id: number;
  name: string;
  api_reference?: string;
  item_code?: string;
  strength?: string;
  packaging?: string;
  item_type?: string;
  manufacturer?: string;
  marketed_by?: string;
  manufactured_by?: string;
  mrp?: number;
  purchase_price?: number;
  gst?: string;
  hsn?: string;
  pack_size?: string;
  schedule_type?: string;
}

export interface InventoryItem extends Medicine {
  batch_number: string;
  expiry_date: string;
  stock_quantity: number;
  loose_quantity: number;
  rack_location?: string;
  medicine_id?: number;
  medicine_name?: string;
}

export interface SpecialOrder {
  id: number;
  product: string;
  requester: string;
  phone: string;
  qty: number;
  priority: string;
  status: string;
  date: string;
  notified: number;
  pharmarack_distributor?: string;
  pharmarack_rate?: number;
  pharmarack_mrp?: number;
  pharmarack_mapped?: number;
  pharmarack_scheme?: string;
  advance_payment?: number;
}

export interface Refill {
  id: number;
  patient_name: string;
  patient_phone: string;
  medicine_id: number;
  medicine_name?: string;
  refill_interval_days: number;
  last_refill_date: string;
  next_refill_date: string;
  status: string;
  hold_for_stock?: number;
  is_active: number;
  is_ready?: number;
}

export interface AutomationNotification {
  id: number;
  type: string;
  recipient_name: string;
  recipient_phone: string;
  message: string;
  status: string;
  error_message?: string;
  created_at: string;
  reference_id?: string;
}


// API methods mapping
export const api = {
  getDashboard: () => apiClient.get<DashboardStats>('/dashboard').then(res => res.data),
  dismissDashboardAlert: (id: number) => apiClient.delete(`/dashboard/alerts/${id}`).then(res => res.data),
  
  // Inventory
  getInventory: (params?: {
    search?: string;
    limit?: number;
    page?: number;
    medicine?: string;
    batch?: string;
    expiry?: string;
    packs?: string;
    loose?: string;
    mrp?: string;
    rack?: string;
  }) => apiClient.get<any>('/inventory', { params }).then(res => res.data),
  addMedicine: (data: Partial<InventoryItem>) => apiClient.post('/inventory', data).then(res => res.data),
  updateMedicine: (id: number, data: Partial<InventoryItem>) => apiClient.put(`/inventory/${id}`, data).then(res => res.data),
  getEnrichedMedicine: (id: number) => apiClient.get(`/inventory/medicines/${id}/enriched`).then(res => res.data),
  getQuickEditMedicine: (id: number) => apiClient.get(`/inventory/medicines/${id}/quick-edit`).then(res => res.data),
  updateQuickEditMedicine: (id: number, data: any) => apiClient.put(`/inventory/medicines/${id}/quick-edit`, data).then(res => res.data),
  
  // Sales / POS
  getSalesHistory: () => apiClient.get('/sales/history').then(res => res.data),
  createSale: (data: any) => apiClient.post('/sales', data).then(res => res.data),
  holdBill: (data: any) => apiClient.post('/sales/hold', data).then(res => res.data),
  getHeldBills: () => apiClient.get('/sales/hold').then(res => res.data),
  restoreHeldBill: (id: number) => apiClient.post(`/sales/hold/${id}/restore`).then(res => res.data),
  searchMedicine: (q: string) => apiClient.get('/sales/search-medicine', { params: { q } }).then(res => res.data),
  
  // Sells (invoice list/edit)
  listSales: (params?: { search?: string; date_from?: string; date_to?: string; batch?: string; limit?: number }) =>
    apiClient.get('/sales/list', { params }).then(res => res.data),
  getSale: (id: number) => apiClient.get(`/sales/${id}`).then(res => res.data),
  updateSale: (id: number, data: any) => apiClient.put(`/sales/${id}`, data).then(res => res.data),
  deleteSale: (id: number) => apiClient.delete(`/sales/${id}`).then(res => res.data),
  
  // Purchases
  getPurchases: (params?: { limit?: number; start?: string; end?: string; months?: number; search?: string }) => apiClient.get('/purchases', { params }).then(res => res.data),
  getEarliestPurchaseDate: () => apiClient.get<{ earliest: string | null }>('/purchases/earliest-date').then(res => res.data),
  getPurchaseItems: () => apiClient.get('/purchases/items/all').then(res => res.data),
  getPurchase: (id: number) => apiClient.get(`/purchases/${id}`).then(res => res.data),
  updatePurchase: (id: number, data: any) => apiClient.put(`/purchases/${id}/full`, data).then(res => res.data),
  deletePurchase: (id: number) => apiClient.delete(`/purchases/${id}`).then(res => res.data),
  createPurchase: (data: any) => apiClient.post('/purchases', data).then(res => res.data),

  // Customer Returns
  searchInvoiceForReturn: (invoice_no: string) => apiClient.get('/customer-returns/search-invoice', { params: { invoice_no } }).then(res => res.data),
  createCustomerReturn: (data: any) => apiClient.post('/customer-returns', data).then(res => res.data),
  getCustomerReturnsHistory: () => apiClient.get('/customer-returns/history').then(res => res.data),
  
  // Returns (Supplier)
  createManualPurchase: (data: any) => apiClient.post('/purchases/manual', data).then(res => res.data),
  getDistributors: () => apiClient.get('/distributors').then(res => res.data),
  getPendingReturns: (distributorId: number) => apiClient.get(`/distributors/${distributorId}/pending-returns`).then(res => res.data),
  getLastPurchase: (name: string, distributorId?: number) => {
    const params: any = { name };
    if (distributorId) params.distributor_id = distributorId;
    return apiClient.get('/purchases/last-purchase', { params }).then(res => res.data);
  },
  batchLastPurchase: (medicines: Array<{name: string}>, distributorId?: number) =>
    apiClient.post('/purchases/batch-last-purchase', { medicines, distributor_id: distributorId }).then(res => res.data),
  catalogSearch: (q: string) => apiClient.get('/inventory/catalog-search', { params: { q } }).then(res => res.data),
  createMedicineAlias: (aliasName: string, medicineId: number) => apiClient.post('/inventory/medicines/alias', { alias_name: aliasName, medicine_id: medicineId }).then(res => res.data),
  getLearnedMapping: (name: string) => apiClient.get('/learning/mapping', { params: { name } }).then(res => res.data),
  getManufacturers: (q: string) => apiClient.get('/manufacturers', { params: { q } }).then(res => res.data),


  
  getPatients: (params?: { q?: string; limit?: number }) => apiClient.get('/crm/patients', { params }).then(r => r.data),
  
  // Migration Endpoints
  uploadMigrationFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/migration/upload', formData, {
      headers: { 'Content-Type': undefined }
    }).then(r => r.data);
  },
  analyzeMigrationFile: (fileName: string, skipLines: number = 0) => 
    apiClient.post('/migration/analyze', { fileName, skipLines }).then(r => r.data),
  analyzeZipFile: (fileName: string) =>
    apiClient.post('/migration/analyze-zip', { fileName }).then(r => r.data),
  analyzeExcelFile: (fileName: string, sheetIndex?: number, skipLines?: number) =>
    apiClient.post('/migration/analyze-excel', { fileName, sheetIndex, skipLines }).then(r => r.data),
  preMigrationAnalyze: (fileName: string, skipLines: number = 0, sheetIndex: number = 0, userMapping?: any) =>
    apiClient.post('/migration/pre-migration-analyze', { fileName, skipLines, sheetIndex, userMapping }).then(r => r.data),
  preMigrationSimulate: (fileName: string, dataType: string, mapping: any, skipLines: number = 0, sheetIndex: number = 0, filters?: any) =>
    apiClient.post('/migration/pre-migration-simulate', { fileName, dataType, mapping, skipLines, sheetIndex, filters }).then(r => r.data),
  runMigration: (fileName: string, dataType: string, mapping: any, skipLines: number = 0, sheetIndex: number = 0, filters?: any, medicineActions?: any) => 
    apiClient.post('/migration/run', { fileName, dataType, mapping, skipLines, sheetIndex, filters, medicineActions }).then(r => r.data),
  runMigrationQueue: (tasks: any[]) =>
    apiClient.post('/migration/run', { tasks }).then(r => r.data),
  getMigrationStatus: () => apiClient.get('/migration/status').then(r => r.data),
  getStagingInventory: () => apiClient.get('/migration/staging/inventory').then(r => r.data),
  updateStagingInventory: (id: number, data: any) => apiClient.put(`/migration/staging/inventory/${id}`, data).then(r => r.data),
  deleteStagingInventory: (id: number) => apiClient.delete(`/migration/staging/inventory/${id}`).then(r => r.data),
  getStagingSales: () => apiClient.get('/migration/staging/sales').then(r => r.data),
  updateStagingSales: (id: number, data: any) => apiClient.put(`/migration/staging/sales/${id}`, data).then(r => r.data),
  deleteStagingSales: (id: number) => apiClient.delete(`/migration/staging/sales/${id}`).then(r => r.data),
  getStagingPurchases: () => apiClient.get('/migration/staging/purchases').then(r => r.data),
  updateStagingPurchases: (id: number, data: any) => apiClient.put(`/migration/staging/purchases/${id}`, data).then(r => r.data),
  deleteStagingPurchases: (id: number) => apiClient.delete(`/migration/staging/purchases/${id}`).then(r => r.data),
  getStagingReturns: () => apiClient.get('/migration/staging/returns').then(r => r.data),
  updateStagingReturns: (id: number, data: any) => apiClient.put(`/migration/staging/returns/${id}`, data).then(r => r.data),
  deleteStagingReturns: (id: number) => apiClient.delete(`/migration/staging/returns/${id}`).then(r => r.data),
  getStagingSaleItems: (id: number) => apiClient.get(`/migration/staging/sales/${id}/items`).then(r => r.data),
  updateStagingSaleItem: (invoiceId: number, itemId: number, data: any) => apiClient.put(`/migration/staging/sales/${invoiceId}/items/${itemId}`, data).then(r => r.data),
  deleteStagingSaleItem: (invoiceId: number, itemId: number) => apiClient.delete(`/migration/staging/sales/${invoiceId}/items/${itemId}`).then(r => r.data),
  addStagingSaleItem: (invoiceId: number, data: any) => apiClient.post(`/migration/staging/sales/${invoiceId}/items`, data).then(r => r.data),

  getStagingPurchaseItems: (id: number) => apiClient.get(`/migration/staging/purchases/${id}/items`).then(r => r.data),
  updateStagingPurchaseItem: (purchaseId: number, itemId: number, data: any) => apiClient.put(`/migration/staging/purchases/${purchaseId}/items/${itemId}`, data).then(r => r.data),
  deleteStagingPurchaseItem: (purchaseId: number, itemId: number) => apiClient.delete(`/migration/staging/purchases/${purchaseId}/items/${itemId}`).then(r => r.data),
  addStagingPurchaseItem: (purchaseId: number, data: any) => apiClient.post(`/migration/staging/purchases/${purchaseId}/items`, data).then(r => r.data),

  getStagingReturnItems: (id: number) => apiClient.get(`/migration/staging/returns/${id}/items`).then(r => r.data),
  updateStagingReturnItem: (returnId: number, itemId: number, data: any) => apiClient.put(`/migration/staging/returns/${returnId}/items/${itemId}`, data).then(r => r.data),
  deleteStagingReturnItem: (returnId: number, itemId: number) => apiClient.delete(`/migration/staging/returns/${returnId}/items/${itemId}`).then(r => r.data),
  addStagingReturnItem: (returnId: number, data: any) => apiClient.post(`/migration/staging/returns/${returnId}/items`, data).then(r => r.data),
  getStagingErrors: () => apiClient.get('/migration/staging/errors').then(r => r.data),
  finalizeMigration: (regenerateInvoices: boolean = false) => 
    apiClient.post('/migration/staging/finalize', { regenerateInvoices }).then(r => r.data),
  rollbackMigration: () =>
    apiClient.delete('/migration/staging/rollback').then(r => r.data),

  // V2 endpoints
  getProjects: () => apiClient.get('/migration/projects').then(r => r.data),
  createProject: (name: string) => apiClient.post('/migration/projects', { name }).then(r => r.data),
  deleteProject: (id: number) => apiClient.delete(`/migration/projects/${id}`).then(r => r.data),
  getTemplates: () => apiClient.get('/migration/templates').then(r => r.data),
  saveTemplate: (name: string, moduleType: string, mappings: any) => apiClient.post('/migration/templates', { name, moduleType, mappings }).then(r => r.data),
  getStagingConflicts: () => apiClient.get('/migration/staging/conflicts').then(r => r.data),
  resolveStagingConflict: (conflictId: number, resolution: string) => apiClient.post('/migration/staging/resolve', { conflictId, resolution }).then(r => r.data),
  getSnapshots: () => apiClient.get('/migration/snapshots').then(r => r.data),
  restoreSnapshot: (snapshotId: number) => apiClient.post('/migration/snapshots/restore', { snapshotId }).then(r => r.data),

  
  addPatient: (data: any) => apiClient.post('/crm/patients', data).then(res => res.data),
  getDoctors: () => apiClient.get('/crm/doctors').then(res => res.data),
  addDoctor: (data: any) => apiClient.post('/crm/doctors', data).then(res => res.data),
  updateDoctor: (id: number | string, data: any) => apiClient.put(`/crm/doctors/${id}`, data).then(res => res.data),
  sendDailyDoctorReports: (date?: string) => apiClient.post('/crm/doctors/send-daily-reports', { date }).then(res => res.data),
  
  // Email / Mail Parser
  getEmailInbox: (limit: number = 50) => apiClient.get('/email/inbox', { params: { limit } }).then(res => res.data),
  getEmailAttachments: () => apiClient.get('/email/attachments').then(res => res.data),
  getEmailAttachmentsById: (emailId: number) => apiClient.get(`/email/${emailId}/attachments`).then(res => res.data),
  parseAttachment: (filename: string, importData: boolean = true) => apiClient.post('/email/attachments/parse', { filename, importData }).then(res => res.data),
  importManualEmail: (data: any) => apiClient.post('/email/import-manual', data).then(res => res.data),
  markEmailSeen: (emailId: number) => apiClient.post(`/email/${emailId}/seen`).then(res => res.data),
  markEmailSaved: (uid: number) => apiClient.post(`/email/${uid}/saved`).then(res => res.data),
  triggerEmailSync: () => apiClient.post('/email/sync').then(res => res.data),
  clearAttachmentsCache: () => apiClient.delete('/email/attachments/cache').then(res => res.data),
  getAttachmentPreview: (filename: string) => apiClient.get('/email/attachments/preview', { params: { filename } }).then(res => res.data),
  
  
  // Medicines Database
  getMedicines: (
    page: number = 1, 
    limit: number = 100, 
    search: string = '', 
    sort: string = 'id_desc', 
    letter: string = '', 
    productName: string = '', 
    mrpFilter: string = '', 
    apiFilter: string = '',
    packagingFilter: string = '',
    distributorFilter: string = '',
    category: string = ''
  ) => 
    apiClient.get('/medicines', { 
      params: { 
        page, 
        limit, 
        search, 
        sort, 
        letter, 
        productName, 
        mrpFilter, 
        apiFilter,
        packagingFilter,
        distributorFilter,
        category
      } 
    }).then(res => res.data),

  deleteMedicine: (id: number) => apiClient.delete(`/medicines/${id}`).then(res => res.data),
  bulkDeleteMedicines: (data: {
    ids?: number[];
    all?: boolean;
    search?: string;
    productName?: string;
    mrpFilter?: string;
    apiFilter?: string;
    packagingFilter?: string;
    distributorFilter?: string;
  }) => apiClient.post('/medicines/bulk-delete', data).then(res => res.data),
  createMedicine: (data: any) => apiClient.post('/medicines', data).then(res => res.data),

  getMedicinePriceHistory: (name: string) => apiClient.get('/purchases/price-history', { params: { name } }).then(res => res.data),
  searchPharmarack: (q: string, storeId?: string | number, isMapped?: boolean) => 
    apiClient.get('/pharmarack/search', { 
      params: { 
        q, 
        ...(storeId !== undefined && storeId !== null ? { storeId } : {}),
        ...(isMapped !== undefined && isMapped !== null ? { isMapped } : {})
      } 
    }).then(res => res.data),
  addPharmarackCart: (items: Array<{ 
    productId: string | number; 
    storeId: string | number; 
    qty: number; 
    rate?: number; 
    scheme?: string;
    productCode?: string;
    company?: string;
    productName?: string;
    storeName?: string;
    packaging?: string;
    mapped?: boolean;
  }>) => 
    apiClient.post('/pharmarack/cart/add', { items }).then(res => res.data),
  getPharmarackCart: () => apiClient.get('/pharmarack/cart').then(res => res.data),
  sendManualCartNotification: (data: { storeId: number; storeName: string; deliveryPersons: any[]; items: any[] }) =>
    apiClient.post('/pharmarack/cart/notify-manual', data).then(res => res.data),
  getPharmarackDistributors: () => apiClient.get('/pharmarack/distributors').then(res => res.data),
  checkPharmarackSession: () => apiClient.get('/pharmarack/session-status').then(res => res.data),
  launchPharmarackLoginWindow: () => apiClient.post('/pharmarack/login-window').then(res => res.data),
  
  // Composition Enrichment
  getEnrichmentStatus: () => apiClient.get('/enrichment/status').then(res => res.data),
  startEnrichment: () => apiClient.post('/enrichment/start').then(res => res.data),
  getEnrichmentQueue: (page: number = 1, limit: number = 50, filter: string = 'all') =>
    apiClient.get('/enrichment/queue', { params: { page, limit, filter } }).then(res => res.data),
  updateComposition: (id: number, composition: string) =>
    apiClient.put(`/enrichment/queue/${id}`, { composition }).then(res => res.data),
  
  // Utilities (Barcode generation)
  generateMedicineBarcodes: (items: Array<{ name: string; batch?: string }>) => apiClient.post('/utilities/barcode', { items }).then(res => res.data),
  generateBillBarcode: (code: string) => apiClient.get(`/utilities/barcode/${encodeURIComponent(code)}`).then(res => res.data),
  
  // License
  getLicenseStatus: () => apiClient.get('/license/status').then(res => res.data),
  activateLicense: (key: string) => apiClient.post('/license/activate', { key }).then(res => res.data),

  // WhatsApp Custom UI
  getWhatsappStatus: () => apiClient.get('/messaging/qr').then(res => res.data),
  reconnectWhatsapp: () => apiClient.post('/messaging/reconnect').then(res => res.data),
  launchWhatsappLoginWindow: () => apiClient.post('/messaging/login-window').then(res => res.data),
  getWhatsappChats: () => apiClient.get('/messaging/chats').then(res => res.data),
  getWhatsappMessages: (chatId: string) => apiClient.get(`/messaging/chats/${encodeURIComponent(chatId)}/messages`).then(res => res.data),
  sendWhatsappMessage: (number: string, message: string, file?: { mimetype: string; data: string; filename?: string }) => apiClient.post('/messaging/send', { number, message, file }).then(res => res.data),
  getWhatsappMessageMedia: (chatId: string, messageId: string) => apiClient.get(`/messaging/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/media`).then(res => res.data),
  
  // Returns
  getReturns: (params?: { search?: string; date_from?: string; date_to?: string; min_amount?: number; max_amount?: number; limit?: number }) => apiClient.get('/returns', { params }).then(res => res.data),
  getReturnItems: (id: number) => apiClient.get(`/returns/${id}/items`).then(res => res.data),
  resolveReturnMissing: (id: number) => apiClient.get(`/returns/${id}/resolve-missing`).then(res => res.data),
  deleteReturn: (id: number) => apiClient.delete(`/returns/${id}`).then(res => res.data),
  updateReturn: (id: number, data: { items: any[]; total_amount: number }) => apiClient.put(`/returns/${id}`, data).then(res => res.data),
  createReturn: (data: any) => apiClient.post('/returns', data).then(res => res.data),
  getNearExpiry: (months: number = 6) => apiClient.get('/returns/near-expiry', { params: { months } }).then(res => res.data),
  lookupPurchases: (name: string, batch?: string) => {
    const params: any = { name };
    if (batch) params.batch = batch;
    return apiClient.get('/returns/lookup-purchases', { params }).then(res => res.data);
  },
  processReturns: (items: any[]) => apiClient.post('/returns/process-returns', { items }).then(res => res.data),
  exportReturnsPDF: (items: any[]) => apiClient.post('/returns/export-pdf-report', { items }, { responseType: 'blob' }).then(res => res.data),
  
  // Purchase PDF
  getPurchasePDF: (id: number) => apiClient.get(`/purchases/${id}/pdf`, { responseType: 'blob' }).then(res => res.data),

  // Orders & Special Requests
  getOrders: () => apiClient.get<SpecialOrder[]>('/orders').then(res => res.data),
  createOrder: (data: Partial<SpecialOrder>) => apiClient.post('/orders', data).then(res => res.data),
  updateOrder: (id: number, data: Partial<SpecialOrder>) => apiClient.put(`/orders/${id}`, data).then(res => res.data),
  deleteOrder: (id: number) => apiClient.delete(`/orders/${id}`).then(res => res.data),
  getUncollectedAlerts: () => apiClient.get<SpecialOrder[]>('/orders/uncollected-alerts').then(res => res.data),
  convertToRefill: (orderId: number, refillIntervalDays: number) =>
    apiClient.post('/orders/convert-to-refill', { orderId, refillIntervalDays }).then(res => res.data),

  // Expiry Monitor
  getExpiryList: (days?: number) => apiClient.get('/expiry', { params: { days } }).then(res => res.data),
  sendExpiryAlerts: (data: { phone?: string, days?: number }) => apiClient.post('/expiry/send-alerts', data).then(res => res.data),

  // Dispatch Orders
  getDispatchOrders: () => apiClient.get('/dispatch/orders').then(res => res.data),
  createDispatchOrder: (data: any) => apiClient.post('/dispatch/orders', data).then(res => res.data),
  updateDispatchOrder: (id: number, data: any) => apiClient.put(`/dispatch/orders/${id}`, data).then(res => res.data),
  deleteDispatchOrder: (id: number) => apiClient.delete(`/dispatch/orders/${id}`).then(res => res.data),
  getDeliveryBoys: () => apiClient.get('/dispatch/delivery-boys').then(res => res.data),
  addDeliveryBoy: (data: { name: string; whatsapp_number?: string; telegram_chat_id?: string; is_active?: number }) =>
    apiClient.post('/dispatch/delivery-boys', data).then(res => res.data),
  updateDeliveryBoy: (id: number, data: { name?: string; whatsapp_number?: string; telegram_chat_id?: string; is_active?: number }) =>
    apiClient.put(`/dispatch/delivery-boys/${id}`, data).then(res => res.data),
  deleteDeliveryBoy: (id: number) => apiClient.delete(`/dispatch/delivery-boys/${id}`).then(res => res.data),

  // CRM — extended
  updatePatient: (id: number, data: any) => apiClient.put(`/crm/patients/${id}`, data).then(res => res.data),
  deletePatient: (id: number) => apiClient.delete(`/crm/patients/${id}`).then(res => res.data),
  deleteDoctor: (id: number | string) => apiClient.delete(`/crm/doctors/${id}`).then(res => res.data),
  getPatientHistory: (id: number) => apiClient.get(`/crm/${id}/history`).then(res => res.data),

  // Catalog Upload & Import
  uploadCatalogFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/upload', formData, {
      headers: { 'Content-Type': undefined }
    }).then(r => r.data);
  },
  getCatalogJobs: () => apiClient.get('/jobs').then(res => res.data),
  getCatalogJobStatus: (id: number) => apiClient.get(`/catalog/job/${id}`).then(res => res.data),
  importCatalog: (medicines: any[]) => apiClient.post('/catalog/import', { medicines }).then(res => res.data),
  importCatalogJob: (id: number, mappings?: any, filters?: any) => apiClient.post(`/catalog/import-job/${id}`, { mappings, filters }).then(res => res.data),
  pauseCatalogJob: (id: number) => apiClient.post(`/catalog/job/${id}/pause`).then(res => res.data),
  resumeCatalogJob: (id: number) => apiClient.post(`/catalog/job/${id}/resume`).then(res => res.data),
  deleteCatalogJob: (id: number) => apiClient.delete(`/catalog/job/${id}`).then(res => res.data),
  getCatalogJobReviews: (id: number) => apiClient.get(`/catalog/job/${id}/reviews`).then(res => res.data),
  approveCatalogReview: (id: number, approvedData: any) => apiClient.post(`/catalog/review/${id}/approve`, { approvedData }).then(res => res.data),
  rejectCatalogReview: (id: number) => apiClient.post(`/catalog/review/${id}/reject`).then(res => res.data),
  enrichCatalogReview: (id: number) => apiClient.post(`/catalog/review/${id}/enrich`).then(res => res.data),
  getGoogleSearchStatus: () => apiClient.get(`/catalog/search-status`).then(res => res.data),
  
  // Reconciliation
  getReconciliationList: () => apiClient.get('/purchases/reconciliation').then(res => res.data),
  reissueOrder: (emailUid: number) => apiClient.post('/purchases/reconciliation/reissue', { email_uid: emailUid }).then(res => res.data),
  resolveOrderManually: (emailUid: number) => apiClient.post('/purchases/reconciliation/resolve', { email_uid: emailUid }).then(res => res.data),

  // Staged / Offline Sync Review
  getStagedSales: (all?: boolean) => apiClient.get(all ? '/sales/staged?all=true' : '/sales/staged').then(res => res.data),
  approveStagedSale: (id: number, data: any) => apiClient.post(`/sales/staged/${id}/approve`, data).then(res => res.data),
  rejectStagedSale: (id: number) => apiClient.post(`/sales/staged/${id}/reject`).then(res => res.data),
  getStagedPurchases: () => apiClient.get('/purchases/staged').then(res => res.data),
  approveStagedPurchase: (id: number, data: any) => apiClient.post(`/purchases/staged/${id}/approve`, data).then(res => res.data),
  rejectStagedPurchase: (id: number) => apiClient.post(`/purchases/staged/${id}/reject`).then(res => res.data),
  getConnectionInfo: () => apiClient.get('/notifications/connection-info').then(res => res.data),
  getActionLogs: () => apiClient.get('/notifications/action-logs').then(res => res.data),
  clearActionLogs: () => apiClient.post('/notifications/action-logs/clear').then(res => res.data),
  getAssistantChatLogs: () => apiClient.get('/notifications/chat-logs').then(res => res.data),
  clearAssistantChatLogs: () => apiClient.post('/notifications/chat-logs/clear').then(res => res.data),

  // Refills
  getRefills: () => apiClient.get<Refill[]>('/refills').then(res => res.data),
  createRefill: (data: Partial<Refill>) => apiClient.post('/refills', data).then(res => res.data),
  updateRefill: (id: number, data: Partial<Refill>) => apiClient.put(`/refills/${id}`, data).then(res => res.data),
  deleteRefill: (id: number) => apiClient.delete(`/refills/${id}`).then(res => res.data),
  sendRefillNow: (id: number) => apiClient.post(`/refills/${id}/send`).then(res => res.data),
  acknowledgeRefill: (id: number) => apiClient.post(`/refills/${id}/acknowledge`).then(res => res.data),
  skipRefill: (id: number) => apiClient.post(`/refills/${id}/skip`).then(res => res.data),

  // Automation / Communication logs
  getAutomationNotifications: (params?: { type?: string; status?: string; search?: string; limit?: number }) =>
    apiClient.get<AutomationNotification[]>('/automation/notifications', { params }).then(res => res.data),
  retryNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/retry`).then(res => res.data),
  cancelNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/cancel`).then(res => res.data),
  manualNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/manual`).then(res => res.data),

  // Investigation Center
  searchInvestigation: (params: any) => apiClient.get('/investigation/search', { params }).then(res => res.data),
  getInvestigationTimeline: (params: any) => apiClient.get('/investigation/timeline', { params }).then(res => res.data),
  getInvestigationDetails: (inventoryId: number) => apiClient.get(`/investigation/details/${inventoryId}`).then(res => res.data),
  updateInvestigationInventory: (inventoryId: number, data: any) => apiClient.put(`/investigation/inventory/${inventoryId}`, data).then(res => res.data),
  updateInvestigationSaleBill: (invoiceId: number, data: any) => apiClient.put(`/investigation/sales/${invoiceId}`, data).then(res => res.data),
  updateInvestigationPurchaseBill: (purchaseId: number, data: any) => apiClient.put(`/investigation/purchases/${purchaseId}`, data).then(res => res.data),
  getInvestigationAuditLogs: (inventoryId: number) => apiClient.get(`/investigation/audit-logs/${inventoryId}`).then(res => res.data),
  
  // Online enrichment & search
  onlineSearch: (q: string) => apiClient.get('/medicines/online-search', { params: { q } }).then(res => res.data),
  autoEnrich: (data: { name: string; api_reference: string; manufacturer?: string }) => apiClient.post('/medicines/auto-enrich', data).then(res => res.data),
  
  // Reports
  getReportsSummary: (params: { fromDate?: string; toDate?: string }) => apiClient.get('/reports', { params }).then(res => res.data),
  getReportsData: (params: { type: string; fromDate?: string; toDate?: string }) => apiClient.get('/reports/data', { params }).then(res => res.data),
  exportReportsPDF: (params: { type: string; fromDate?: string; toDate?: string }) => apiClient.get('/reports/export-pdf', { params, responseType: 'blob' }).then(res => res.data),
  exportReportsExcel: (params: { type: string; fromDate?: string; toDate?: string }) => apiClient.get('/reports/export-excel', { params, responseType: 'blob' }).then(res => res.data),
};
