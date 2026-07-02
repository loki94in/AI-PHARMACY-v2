---
name: mail-attachment-picker-design
description: Focused mail page design for selecting email attachments to process into purchase bills - simple workflow for distributor invoices.
metadata:
  type: project
---

# Mail Attachment Picker — Purchase Bill Workflow

## 1. Simple Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  INBOX EMAILS                                                   │
│  ─────────────────────────────────────────────────────────────  │
│  [Email 1: Distributor A - Invoice #1234]  ← Select this       │
│  [Email 2: Distributor B - Price List]                         │
│  [Email 3: Distributor C - Invoice #5678]  ← Or this           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  SELECTED EMAIL: Distributor A - Invoice #1234                  │
│  ─────────────────────────────────────────────────────────────  │
│  FROM: distributor-a@pharma.com                                │
│  SUBJECT: Invoice #1234 for medicines                          │
│  DATE: June 3, 2026                                            │
│                                                                 │
│  ATTACHMENTS (3 files):                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [✓] invoice.pdf      2.3 MB   PDF Invoice              │   │
│  │ [ ] stock_list.csv   156 KB   Stock List                │   │
│  │ [ ] price_list.xlsx  89 KB    Price List                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Process Selected File → Create Purchase Bill]                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  PURCHASE BILL CREATION                                         │
│  ─────────────────────────────────────────────────────────────  │
│  Distributor: Distributor A                                     │
│  Invoice #: 1234                                               │
│  File: invoice.pdf                                             │
│                                                                 │
│  MEDICINES EXTRACTED:                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Name              Batch    Qty    Price    Expiry       │   │
│  │ Amoxicillin 500mg B-123   100    ₹15.00   Dec 2026    │   │
│  │ Paracetamol 650mg C-456   200    ₹4.00    Nov 2026     │   │
│  │ Ibuprofen 400mg   D-789   50     ₹8.50    Jan 2027     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Confirm & Add to Inventory]  [Cancel]                         │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Page Layout (Simplified)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER                                                        │
│  📧 Mail Inbox - Purchase Bills                    [Refresh]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LEFT PANEL (60%)              │  RIGHT PANEL (40%)            │
│  ─────────────────────         │  ──────────────────────       │
│                                │                               │
│  INBOX EMAILS                  │  SELECTED EMAIL DETAILS       │
│  ─────────────                 │  ──────────────────────       │
│                                │                               │
│  [Email 1] ← Selected         │  From: distributor@...        │
│  [Email 2]                    │  Subject: Invoice #1234       │
│  [Email 3]                    │  Date: Jun 3, 2026            │
│  [Email 4]                    │                               │
│  [Email 5]                    │  ATTACHMENTS:                 │
│                                │  ┌───────────────────────┐   │
│  ─────────────                 │  │ [✓] invoice.pdf       │   │
│  Total: 25 emails             │  │ [ ] stock_list.csv    │   │
│  Unread: 8                    │  │ [ ] price_list.xlsx   │   │
│                                │  └───────────────────────┘   │
│                                │                               │
│                                │  [Process Selected →]         │
│                                │                               │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Component Design

### 3.1 Email List Component
```tsx
// Shows all inbox emails with simple selection
interface EmailListItem {
  id: number;
  from: string;           // Distributor name/email
  subject: string;        // Email subject
  date: string;           // Received date
  hasAttachments: boolean; // Shows paperclip icon
  isRead: boolean;        // Bold if unread
  attachmentCount: number; // Number of attachments
}

// Visual design:
// ┌─────────────────────────────────────────┐
// │ 📧 distributor-a@pharma.com     2h ago │
// │    Invoice #1234 for medicines    📎 3  │
// ├─────────────────────────────────────────┤
// │ 📧 distributor-b@pharma.com   Yesterday│
// │    Price list update             📎 1   │
// └─────────────────────────────────────────┘
```

### 3.2 Attachment Picker Component
```tsx
// Shows attachments from selected email with checkboxes
interface AttachmentItem {
  filename: string;
  size: number;           // Bytes
  contentType: string;    // PDF, CSV, Excel, etc.
  isSelected: boolean;    // Checkbox state
  isProcessing: boolean;  // Loading state
}

// Visual design:
// ┌─────────────────────────────────────────────────┐
// │ ATTACHMENTS (3 files)                           │
// │                                                 │
// │ [✓] 📄 invoice.pdf      2.3 MB   PDF Invoice   │
// │ [ ] 📊 stock_list.csv   156 KB   Stock List     │
// │ [ ] 📊 price_list.xlsx  89 KB    Price List     │
// │                                                 │
// │ Select: [All] [PDF only] [CSV only]            │
// └─────────────────────────────────────────────────┘
```

### 3.3 Process Button
```tsx
// Action button to process selected files
interface ProcessButtonProps {
  selectedCount: number;
  isProcessing: boolean;
  onProcess: () => void;
}

// Visual design:
// ┌─────────────────────────────────────────┐
// │  Selected: 1 file                       │
// │                                         │
// │  [Process & Create Purchase Bill →]     │
// │                                         │
// └─────────────────────────────────────────┘
```

## 4. Backend API (Minimal)

### 4.1 Get Inbox Emails
```
GET /api/mail/inbox
Response: [
  {
    "id": 1,
    "from": "distributor-a@pharma.com",
    "subject": "Invoice #1234",
    "date": "2026-06-03T10:30:00Z",
    "hasAttachments": true,
    "attachmentCount": 3
  },
  ...
]
```

### 4.2 Get Email Attachments
```
GET /api/mail/:id/attachments
Response: [
  {
    "filename": "invoice.pdf",
    "size": 2411724,
    "contentType": "application/pdf",
    "path": "/uploads/invoice.pdf"
  },
  ...
]
```

### 4.3 Process Selected Attachment
```
POST /api/mail/process-attachment
Body: {
  "emailId": 1,
  "filename": "invoice.pdf"
}
Response: {
  "success": true,
  "extractedData": {
    "distributor": "Distributor A",
    "invoiceNumber": "1234",
    "medicines": [
      {
        "name": "Amoxicillin 500mg",
        "batch": "B-123",
        "quantity": 100,
        "price": 15.00,
        "expiry": "2026-12-31"
      }
    ]
  }
}
```

### 4.4 Create Purchase Bill
```
POST /api/purchases/from-email
Body: {
  "emailId": 1,
  "filename": "invoice.pdf",
  "distributorId": 123,
  "invoiceNumber": "1234",
  "medicines": [...]
}
Response: {
  "success": true,
  "purchaseId": 456
}
```

## 5. Frontend Implementation

### 5.1 Simplified Mail Page
```tsx
// File: frontend/src/pages/Mail.tsx (simplified)
import { useState, useEffect } from 'react';
import { Mail as MailIcon, Paperclip, RefreshCw, FileText, Loader } from 'lucide-react';
import { api } from '../services/api';

interface Email {
  id: number;
  from: string;
  subject: string;
  date: string;
  hasAttachments: boolean;
  attachmentCount: number;
}

interface Attachment {
  filename: string;
  size: number;
  contentType: string;
  isSelected: boolean;
}

const Mail = () => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Fetch inbox emails
  const fetchEmails = async () => {
    setLoading(true);
    try {
      const data = await api.getEmailInbox();
      setEmails(data || []);
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch attachments when email is selected
  const fetchAttachments = async (emailId: number) => {
    try {
      const data = await api.getEmailAttachments(emailId);
      setAttachments(data.map((att: any) => ({ ...att, isSelected: false })));
    } catch (error) {
      console.error('Error fetching attachments:', error);
    }
  };

  // Handle email selection
  const handleEmailSelect = (email: Email) => {
    setSelectedEmail(email);
    fetchAttachments(email.id);
  };

  // Handle attachment selection
  const handleAttachmentToggle = (filename: string) => {
    setAttachments(prev => 
      prev.map(att => 
        att.filename === filename 
          ? { ...att, isSelected: !att.isSelected }
          : att
      )
    );
  };

  // Process selected attachments
  const handleProcess = async () => {
    if (!selectedEmail) return;
    
    const selectedFiles = attachments.filter(att => att.isSelected);
    if (selectedFiles.length === 0) {
      alert('Please select at least one file to process');
      return;
    }

    setProcessing(true);
    try {
      // Process each selected file
      for (const file of selectedFiles) {
        await api.processEmailAttachment(selectedEmail.id, file.filename);
      }
      
      // Show success and refresh
      alert(`Successfully processed ${selectedFiles.length} file(s)`);
      fetchEmails(); // Refresh inbox
      setSelectedEmail(null);
      setAttachments([]);
    } catch (error) {
      console.error('Error processing attachments:', error);
      alert('Failed to process attachments');
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  return (
    <div className="h-full flex flex-col fade-in space-y-5 overflow-hidden pb-4">
      {/* Header */}
      <div className="glass-panel p-4 flex flex-wrap items-center justify-between gap-4 bg-white/5 border-glass-border">
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-text flex items-center gap-2">
            <MailIcon size={20} className="text-primary" />
            Mail Inbox - Purchase Bills
          </h3>
          <p className="text-xs text-muted">
            Select emails to view attachments and process into purchase bills
          </p>
        </div>
        <button 
          onClick={fetchEmails}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-glass-border/60 text-text transition-all flex items-center gap-2 text-xs font-semibold"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-5 overflow-hidden">
        {/* Left Panel: Email List (60%) */}
        <div className="lg:col-span-3 glass-panel flex flex-col overflow-hidden bg-white/5 border-glass-border">
          <div className="p-3 border-b border-glass-border bg-black/10 text-xs font-bold text-muted uppercase tracking-wider select-none">
            Inbox Emails ({emails.length})
          </div>
          <div className="flex-1 overflow-y-auto bg-black/10 divide-y divide-glass-border/20">
            {loading ? (
              <div className="p-12 text-center text-muted flex flex-col items-center gap-3">
                <Loader className="animate-spin text-primary" size={24} />
                <span className="text-xs uppercase font-semibold animate-pulse">Loading emails...</span>
              </div>
            ) : emails.length === 0 ? (
              <div className="p-16 text-center text-muted flex flex-col items-center gap-2 italic text-xs">
                <MailIcon size={28} className="text-green opacity-80" />
                No emails in inbox
              </div>
            ) : (
              emails.map((email) => (
                <button
                  key={email.id}
                  onClick={() => handleEmailSelect(email)}
                  className={`w-full text-left p-4 hover:bg-white/5 transition-all flex items-start gap-4 ${
                    selectedEmail?.id === email.id 
                      ? 'bg-primary/5 border-l-2 border-primary' 
                      : 'border-l-2 border-transparent'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-white/5 text-primary border border-glass-border flex-shrink-0">
                    <MailIcon size={16} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-text truncate">
                        {email.from}
                      </span>
                      <span className="text-[10px] text-muted font-mono">
                        {new Date(email.date).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-sky truncate">{email.subject}</h4>
                    <div className="flex items-center gap-2">
                      {email.hasAttachments && (
                        <span className="text-[10px] text-green flex items-center gap-1">
                          <Paperclip size={10} /> {email.attachmentCount} files
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel: Email Details & Attachments (40%) */}
        <div className="lg:col-span-2 glass-panel p-5 flex flex-col bg-white/5 border-glass-border overflow-hidden">
          {selectedEmail ? (
            <div className="flex flex-col h-full overflow-hidden space-y-4">
              {/* Email Header */}
              <div className="border-b border-glass-border pb-3 space-y-2 flex-shrink-0">
                <h4 className="text-xs font-bold text-sky uppercase tracking-wide">Email Details</h4>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="font-bold text-muted mr-1.5">From:</span>
                    <span className="font-semibold text-text">{selectedEmail.from}</span>
                  </div>
                  <div>
                    <span className="font-bold text-muted mr-1.5">Subject:</span>
                    <span className="font-semibold text-text">{selectedEmail.subject}</span>
                  </div>
                  <div>
                    <span className="font-bold text-muted mr-1.5">Date:</span>
                    <span className="font-mono text-muted">
                      {new Date(selectedEmail.date).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Attachments Section */}
              <div className="flex-1 overflow-y-auto space-y-3">
                <h4 className="text-xs font-bold text-muted uppercase tracking-wider">
                  Attachments ({attachments.length} files)
                </h4>
                
                {attachments.length === 0 ? (
                  <div className="p-8 text-center text-muted text-xs">
                    No attachments in this email
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attachments.map((att) => (
                      <div 
                        key={att.filename}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          att.isSelected 
                            ? 'bg-primary/10 border-primary/30' 
                            : 'bg-white/5 border-glass-border hover:bg-white/10'
                        }`}
                        onClick={() => handleAttachmentToggle(att.filename)}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={att.isSelected}
                            onChange={() => handleAttachmentToggle(att.filename)}
                            className="premium-input"
                          />
                          <div className="p-2 rounded-lg bg-white/5 border border-glass-border">
                            <FileText size={16} className="text-sky" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-text truncate">
                              {att.filename}
                            </div>
                            <div className="text-[10px] text-muted">
                              {(att.size / 1024).toFixed(1)} KB • {att.contentType}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Select Buttons */}
                {attachments.length > 0 && (
                  <div className="flex gap-2 pt-2">
                    <button 
                      onClick={() => setAttachments(prev => prev.map(a => ({ ...a, isSelected: true })))}
                      className="text-[10px] font-bold text-primary hover:text-blue-400"
                    >
                      Select All
                    </button>
                    <span className="text-[10px] text-muted">|</span>
                    <button 
                      onClick={() => setAttachments(prev => prev.map(a => ({ ...a, isSelected: false })))}
                      className="text-[10px] font-bold text-muted hover:text-text"
                    >
                      Clear All
                    </button>
                    <span className="text-[10px] text-muted">|</span>
                    <button 
                      onClick={() => setAttachments(prev => prev.map(a => ({ 
                        ...a, 
                        isSelected: a.contentType.includes('pdf') 
                      })))}
                      className="text-[10px] font-bold text-green hover:text-green/80"
                    >
                      PDF Only
                    </button>
                  </div>
                )}
              </div>

              {/* Process Button */}
              <div className="pt-2 border-t border-glass-border flex-shrink-0">
                <div className="text-xs text-muted mb-2">
                  Selected: {attachments.filter(a => a.isSelected).length} file(s)
                </div>
                <button
                  onClick={handleProcess}
                  disabled={processing || attachments.filter(a => a.isSelected).length === 0}
                  className={`w-full premium-btn text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 ${
                    processing || attachments.filter(a => a.isSelected).length === 0
                      ? 'bg-white/5 border border-glass-border text-muted cursor-not-allowed'
                      : 'bg-green text-text shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:bg-green/90'
                  }`}
                >
                  {processing ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Process & Create Purchase Bill →
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full justify-center items-center text-center space-y-4 py-8">
              <div className="p-4 rounded-full bg-white/5 text-muted border border-glass-border/40 animate-pulse">
                <MailIcon size={32} className="opacity-80" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-text">Select Email</h4>
                <p className="text-xs text-muted max-w-[200px] leading-relaxed">
                  Click on any email from the list to view its attachments and process into purchase bills.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Mail;
```

## 6. Backend Routes (Minimal)

```typescript
// File: src/routes/mail.ts (simplified)
import express from 'express';
import { emailService } from '../services/emailService.js';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// GET /api/mail/inbox - Get all inbox emails
router.get('/inbox', async (req, res) => {
  try {
    const inbox = await emailService.fetchInbox(100); // Get last 100 emails
    
    // Format for frontend
    const emails = inbox.map((email: any) => ({
      id: email.id || Math.random(),
      from: email.from,
      subject: email.subject,
      date: email.date,
      hasAttachments: email.attachments && email.attachments.length > 0,
      attachmentCount: email.attachments ? email.attachments.length : 0,
    }));
    
    res.json(emails);
  } catch (error) {
    console.error('Fetch inbox error:', error);
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// GET /api/mail/:id/attachments - Get attachments for specific email
router.get('/:id/attachments', async (req, res) => {
  try {
    const emailId = req.params.id;
    
    // Get email details (from database or IMAP)
    const email = await emailService.getEmailById(emailId);
    
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    
    // Get attachments from uploads folder
    const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      return res.json([]);
    }
    
    const files = fs.readdirSync(uploadsDir);
    const attachments = files
      .filter(file => file.match(/\.(csv|txt|xlsx?|ods|pdf)$/i))
      .map(filename => {
        const filePath = path.join(uploadsDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          size: stats.size,
          contentType: getContentType(filename),
          path: filePath,
        };
      });
    
    res.json(attachments);
  } catch (error) {
    console.error('Fetch attachments error:', error);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// POST /api/mail/process-attachment - Process selected attachment
router.post('/process-attachment', async (req, res) => {
  try {
    const { emailId, filename } = req.body;
    
    if (!emailId || !filename) {
      return res.status(400).json({ error: 'emailId and filename are required' });
    }
    
    // Process the attachment
    const filePath = path.resolve(__dirname, '..', '..', 'uploads', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Parse and extract data
    const result = await emailService.parseAndImportAttachment(filePath);
    
    res.json({
      success: true,
      message: 'Attachment processed successfully',
      extractedData: result,
    });
  } catch (error) {
    console.error('Process attachment error:', error);
    res.status(500).json({ error: 'Failed to process attachment' });
  }
});

// Helper function to get content type
function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

export default router;
```

## 7. API Service Methods

```typescript
// File: frontend/src/services/api.ts (add these methods)
export const api = {
  // ... existing methods
  
  // Mail methods (simplified)
  getEmailInbox: () => apiClient.get('/mail/inbox').then(res => res.data),
  getEmailAttachments: (emailId: number) => 
    apiClient.get(`/mail/${emailId}/attachments`).then(res => res.data),
  processEmailAttachment: (emailId: number, filename: string) => 
    apiClient.post('/mail/process-attachment', { emailId, filename }).then(res => res.data),
};
```

## 8. User Flow Summary

1. **User opens Mail page** → Sees list of inbox emails
2. **User clicks an email** → Right panel shows email details + attachments
3. **User selects file(s)** → Checkboxes mark files for processing
4. **User clicks "Process"** → System parses file and creates purchase bill
5. **System shows success** → User can process another email or view created bills

## 9. Key Features

### ✅ **Simple & Focused**
- No compose/send functionality (not needed)
- No folders/labels (not needed)
- Just: Select email → Select files → Process

### ✅ **Visual Clarity**
- Left: Email list
- Right: Email details + attachment picker
- Clear selection state with checkboxes

### ✅ **Quick Actions**
- "Select All" / "Clear All" / "PDF Only" buttons
- Single click to select email
- One button to process

### ✅ **Error Handling**
- Loading states
- Error messages
- Validation before processing

## 10. Next Steps

1. **Test with real emails** - Connect to IMAP and verify
2. **Add file previews** - Show PDF/CSV preview before processing
3. **Add batch processing** - Process multiple files at once
4. **Add status tracking** - Show processing history

This simplified design focuses on the core workflow: **Select email → Select files → Create purchase bill**. No extra complexity.