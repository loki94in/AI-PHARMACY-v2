---
name: mail-page-ui-design
description: Visual UI design specification for the enhanced mail page with component layouts, interactions, and workflow diagrams.
metadata:
  type: project
---

# Mail Page UI Design Specification

## 1. Page Layout Structure

### 1.1 Desktop Layout (1024px+)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                                 │
│  [Logo] Mail Client                    [Search_______________] [Compose]   │
├─────────────┬───────────────────────────────────────────────────────────────┤
│  SIDEBAR    │  MAIN CONTENT AREA                                           │
│  (250px)    │  ┌─────────────────────────────────────────────────────────┐  │
│             │  │  MAIL LIST (400px)          │  MAIL DETAIL (remaining) │  │
│  FOLDERS    │  │  ─────────────────────      │  ──────────────────────  │  │
│  ● Inbox(3) │  │  [Email 1]                  │  From: distributor@...   │  │
│  ○ Sent     │  │  [Email 2]                  │  Subject: Invoice #1234  │  │
│  ○ Drafts   │  │  [Email 3]                  │  Date: Jun 3, 2026       │  │
│  ○ Trash    │  │  [Email 4]                  │                         │  │
│             │  │  [Email 5]                  │  [HTML Email Body]       │  │
│  LABELS     │  │                             │                         │  │
│  ■ Orders   │  │  ─────────────────────      │  [Attachments]           │  │
│  ■ Invoices │  │  ◄ Page 1 of 5 ►           │  invoice.pdf (2.3MB)    │  │
│  ■ Alerts   │  │                             │  report.csv (156KB)     │  │
│             │  └─────────────────────────────────────────────────────────┘  │
│  QUICK      │                                                             │
│  FILTERS    │                                                             │
│  □ Unread   │                                                             │
│  □ Attached │                                                             │
│  □ Today    │                                                             │
└─────────────┴───────────────────────────────────────────────────────────────┘
```

### 1.2 Mobile Layout (<768px)
```
┌─────────────────────────┐
│  HEADER BAR             │
│  [≡] Mail    [Search] [+]│
├─────────────────────────┤
│  MAIL LIST              │
│  ─────────────────────  │
│  [Email 1]              │
│  [Email 2]              │
│  [Email 3]              │
│  [Email 4]              │
│  [Email 5]              │
│  ─────────────────────  │
│  ◄ Page 1 of 5 ►       │
└─────────────────────────┘

(When email selected)
┌─────────────────────────┐
│  HEADER BAR             │
│  [←] Email Detail [⋯]   │
├─────────────────────────┤
│  From: distributor@...  │
│  Subject: Invoice #1234 │
│  Date: Jun 3, 2026      │
│                         │
│  [HTML Email Body]      │
│                         │
│  [Attachments]          │
│  invoice.pdf (2.3MB)    │
│                         │
│  [Reply] [Forward] [🗑] │
└─────────────────────────┘
```

## 2. Component Specifications

### 2.1 Mail Header Component
```tsx
// frontend/src/components/mail/MailHeader.tsx
interface MailHeaderProps {
  unreadCount: number;
  onCompose: () => void;
  onSync: () => void;
  onSearch: (query: string) => void;
  isSyncing: boolean;
}

// Layout:
// [Mail Icon] Mail Client
// [Search Input with debounce 300ms]
// [Sync Button with spinner]
// [Compose Button - primary color]
```

**Design Specs:**
- Height: 64px
- Background: `glass-bg` with `border-b border-glass-border`
- Search input: `premium-input` with search icon, 300px width
- Compose button: `premium-btn bg-primary` with plus icon
- Sync button: Icon only with spin animation when syncing

### 2.2 Mail Sidebar Component
```tsx
// frontend/src/components/mail/MailSidebar.tsx
interface MailSidebarProps {
  activeFolder: 'inbox' | 'sent' | 'drafts' | 'trash';
  onFolderChange: (folder: string) => void;
  labels: MailLabel[];
  onLabelClick: (labelId: number) => void;
  activeLabelId?: number;
  quickFilters: {
    unread: boolean;
    hasAttachment: boolean;
    today: boolean;
  };
  onQuickFilterChange: (filters: any) => void;
}

// Layout:
// FOLDERS
// ● Inbox (3)    ← badge shows unread count
// ○ Sent
// ○ Drafts
// ○ Trash
// 
// LABELS
// ■ Orders       ← colored dot
// ■ Invoices
// ■ Alerts
// [+ New Label]
// 
// QUICK FILTERS
// □ Unread only
// □ Has attachment
// □ Today only
```

**Design Specs:**
- Width: 250px (desktop), 100% (mobile drawer)
- Background: `glass-panel` with `bg-white/5`
- Folder items: 40px height, hover effect `bg-white/5`
- Active folder: `bg-primary/10 border-l-2 border-primary`
- Label dots: 8px circles with custom colors
- Quick filters: Checkbox style with `premium-input`

### 2.3 Mail List Component
```tsx
// frontend/src/components/mail/MailList.tsx
interface MailListProps {
  emails: MailEmail[];
  selectedId?: number;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onMarkRead: (id: number) => void;
  onMarkUnread: (id: number) => void;
  onMoveToLabel: (emailId: number, labelId: number) => void;
  loading: boolean;
  pagination: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
  multiSelect: boolean;
  selectedIds: number[];
  onMultiSelectToggle: () => void;
  onBulkAction: (action: string, ids: number[]) => void;
}

// Layout:
// ┌─────────────────────────────────────────────────┐
// │  Select All [✓]  |  Bulk Actions ▼  |  Sort ▼   │
// ├─────────────────────────────────────────────────┤
// │  [Avatar] Distributor A          2h ago    [📎] │
// │          Invoice #1234 - Medicines list...       │
// │          ■ Orders                               │
// ├─────────────────────────────────────────────────┤
// │  [Avatar] Customer B            Yesterday  [ ]  │
// │          Order confirmation                     │
// │          Thank you for your order...            │
// ├─────────────────────────────────────────────────┤
// │  [Avatar] System               Jun 1      [📎] │
// │          Low stock alert                        │
// │          Item X below reorder level...          │
// └─────────────────────────────────────────────────┘
// ◄ Page 1 of 5 ►
```

**Design Specs:**
- Item height: 72px
- Hover: `bg-white/5` with `translateX(2px)`
- Selected: `bg-primary/5 border-l-2 border-primary`
- Unread: Bold subject, blue dot indicator
- Avatar: 32px circle with initials or icon
- Date: Relative time (2h ago, Yesterday, Jun 1)
- Attachment icon: Paperclip if has attachments

### 2.4 Mail Detail Component
```tsx
// frontend/src/components/mail/MailDetail.tsx
interface MailDetailProps {
  email: MailEmail | null;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onAddLabel: (labelId: number) => void;
  onRemoveLabel: (labelId: number) => void;
  labels: MailLabel[];
}

// Layout:
// ┌─────────────────────────────────────────────────┐
// │  From: distributor@pharma.com                   │
// │  To: pharmacy@ai-pharmacy.com                   │
// │  Subject: Invoice #1234 - Medicines list        │
// │  Date: June 3, 2026 10:30 AM                    │
// │  Labels: [Orders] [Invoices] [+ Add]            │
// ├─────────────────────────────────────────────────┤
// │                                                 │
// │  [HTML Email Body in sandboxed iframe]          │
// │                                                 │
// │  Dear Pharmacy,                                 │
// │                                                 │
// │  Please find attached the invoice for your      │
// │  recent order:                                  │
// │                                                 │
// │  - Amoxicillin 500mg (100 units) - ₹1,500      │
// │  - Paracetamol 650mg (200 units) - ₹800         │
// │                                                 │
// │  Total: ₹2,300                                  │
// │                                                 │
// ├─────────────────────────────────────────────────┤
// │  ATTACHMENTS                                    │
// │  ┌─────────────────────────────────────────┐    │
// │  │ 📄 invoice.pdf      2.3 MB  [Download] │    │
// │  │ 📊 report.csv       156 KB  [Preview]  │    │
// │  └─────────────────────────────────────────┘    │
// ├─────────────────────────────────────────────────┤
// │  [Reply] [Reply All] [Forward] [Delete] [⋯]    │
// └─────────────────────────────────────────────────┘
```

**Design Specs:**
- Background: `glass-panel` with `bg-white/5`
- Header section: 4 lines of metadata
- Body: Sandboxed iframe for HTML, max-height 400px with scroll
- Attachments: Grid layout with file icons, sizes, action buttons
- Action bar: Bottom sticky with icon buttons

### 2.5 Compose Modal Component
```tsx
// frontend/src/components/mail/ComposeModal.tsx
interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (email: ComposeEmail) => void;
  onSaveDraft: (email: ComposeEmail) => void;
  templates: EmailTemplate[];
  onTemplateSelect: (templateId: number) => void;
  replyTo?: MailEmail;  // For reply/forward
  forward?: MailEmail;  // For forward
}

interface ComposeEmail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  bodyHtml: string;
  attachments: File[];
  templateId?: number;
}

// Layout:
// ┌─────────────────────────────────────────────────┐
// │  Compose Email                          [×]     │
// ├─────────────────────────────────────────────────┤
// │  To: [distributor@pharma.com] [×]  [+ Add More]│
// │  Cc: [____________________________] [+ Add]     │
// │  Bcc:[____________________________] [+ Add]     │
// ├─────────────────────────────────────────────────┤
// │  Subject: [Invoice #1234 - Medicines list    ]  │
// ├─────────────────────────────────────────────────┤
// │  Template: [Order Confirmation ▼]               │
// ├─────────────────────────────────────────────────┤
// │                                                 │
// │  [Rich Text Editor Toolbar]                     │
// │  ┌─────────────────────────────────────────┐    │
// │  │                                         │    │
// │  │  [Email Body Area]                      │    │
// │  │                                         │    │
// │  │  Bold Italic Underline | List Link      │    │
// │  │                                         │    │
// │  └─────────────────────────────────────────┘    │
// │                                                 │
// ├─────────────────────────────────────────────────┤
// │  ATTACHMENTS                                    │
// │  [Drag & drop files here or click to upload]    │
// │  ┌─────────────────────────────────────────┐    │
// │  │ 📄 invoice.pdf      2.3 MB  [Remove]   │    │
// │  └─────────────────────────────────────────┘    │
// ├─────────────────────────────────────────────────┤
// │  [Save Draft] [Discard]           [Send Email]  │
// └─────────────────────────────────────────────────┘
```

**Design Specs:**
- Modal width: 640px (desktop), 100% (mobile)
- Modal height: 500px (desktop), 100% (mobile)
- Backdrop: `bg-black/60 backdrop-blur-sm`
- To/Cc/Bcc: Tag-style inputs with remove buttons
- Rich text: TipTap or similar, minimal toolbar
- Attachments: Drag & drop zone with preview
- Actions: Save Draft (secondary), Discard (danger), Send (primary)

## 3. Interaction Workflows

### 3.1 Compose New Email Workflow
```
User clicks [Compose] button
↓
Open ComposeModal with empty fields
↓
User fills To, Subject, Body
↓
Optionally select Template → Auto-fill subject & body
↓
Optionally add Attachments (drag & drop or click)
↓
Click [Send Email]
↓
Validate required fields (To, Subject)
↓
POST /api/mail/send
↓
Close modal, show success toast
↓
Refresh mail list, switch to Sent folder
```

### 3.2 Reply to Email Workflow
```
User clicks [Reply] in MailDetail
↓
Open ComposeModal with:
  - To: Original sender
  - Subject: Re: [original subject]
  - Body: [quoted original]
↓
User edits reply content
↓
Click [Send Email]
↓
POST /api/mail/send
↓
Mark original email as replied
↓
Close modal, show success toast
```

### 3.3 Email Search Workflow
```
User types in Search input
↓
Debounce 300ms
↓
GET /api/mail/search?q=search_term
↓
Update MailList with filtered results
↓
Show search result count
↓
User clicks Clear Search
↓
Restore full mail list
```

### 3.4 Label Management Workflow
```
User clicks [+ New Label] in Sidebar
↓
Show inline input for label name
↓
User types name, selects color
↓
POST /api/mail/labels
↓
Add label to sidebar list
↓
User drags email to label (or uses menu)
↓
POST /api/mail/:id/labels
↓
Show label dot on email in list
```

## 4. State Management

### 4.1 Mail Page State
```typescript
// frontend/src/pages/Mail.tsx
interface MailState {
  // Folders & Navigation
  activeFolder: 'inbox' | 'sent' | 'drafts' | 'trash';
  activeLabelId?: number;
  
  // Mail Data
  emails: MailEmail[];
  selectedEmail: MailEmail | null;
  labels: MailLabel[];
  templates: EmailTemplate[];
  
  // UI State
  loading: boolean;
  syncing: boolean;
  searchQuery: string;
  showComposeModal: boolean;
  composeMode: 'new' | 'reply' | 'replyAll' | 'forward';
  replyToEmail?: MailEmail;
  
  // Pagination
  page: number;
  totalPages: number;
  totalEmails: number;
  
  // Multi-select
  multiSelectMode: boolean;
  selectedEmailIds: number[];
  
  // Quick Filters
  quickFilters: {
    unread: boolean;
    hasAttachment: boolean;
    today: boolean;
  };
}
```

### 4.2 API Service Methods
```typescript
// frontend/src/services/api.ts - Mail Methods
export const mailApi = {
  // Folders
  getInbox: (params?: MailQueryParams) => apiClient.get('/mail/inbox', { params }),
  getSent: (params?: MailQueryParams) => apiClient.get('/mail/sent', { params }),
  getDrafts: (params?: MailQueryParams) => apiClient.get('/mail/drafts', { params }),
  getTrash: (params?: MailQueryParams) => apiClient.get('/mail/trash', { params }),
  
  // Single email
  getEmail: (id: number) => apiClient.get(`/mail/${id}`),
  deleteEmail: (id: number) => apiClient.delete(`/mail/${id}`),
  permanentDelete: (id: number) => apiClient.delete(`/mail/${id}/permanent`),
  
  // Actions
  markRead: (id: number) => apiClient.put(`/mail/${id}/read`),
  markUnread: (id: number) => apiClient.put(`/mail/${id}/unread`),
  moveToFolder: (id: number, folder: string) => apiClient.put(`/mail/${id}/move`, { folder }),
  
  // Send
  sendEmail: (data: ComposeEmail) => apiClient.post('/mail/send', data),
  saveDraft: (data: ComposeEmail) => apiClient.post('/mail/draft', data),
  
  // Search
  search: (params: SearchParams) => apiClient.get('/mail/search', { params }),
  
  // Labels
  getLabels: () => apiClient.get('/mail/labels'),
  createLabel: (data: CreateLabelData) => apiClient.post('/mail/labels', data),
  updateLabel: (id: number, data: UpdateLabelData) => apiClient.put(`/mail/labels/${id}`, data),
  deleteLabel: (id: number) => apiClient.delete(`/mail/labels/${id}`),
  addLabelToEmail: (emailId: number, labelId: number) => 
    apiClient.post(`/mail/${emailId}/labels`, { labelId }),
  removeLabelFromEmail: (emailId: number, labelId: number) => 
    apiClient.delete(`/mail/${emailId}/labels/${labelId}`),
  
  // Templates
  getTemplates: () => apiClient.get('/mail/templates'),
  createTemplate: (data: CreateTemplateData) => apiClient.post('/mail/templates', data),
  updateTemplate: (id: number, data: UpdateTemplateData) => 
    apiClient.put(`/mail/templates/${id}`, data),
  deleteTemplate: (id: number) => apiClient.delete(`/mail/templates/${id}`),
  renderTemplate: (id: number, data: any) => 
    apiClient.post(`/mail/templates/${id}/render`, data),
  
  // Attachments
  uploadAttachment: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/mail/attachments/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  downloadAttachment: (id: number) => 
    apiClient.get(`/mail/attachments/${id}`, { responseType: 'blob' }),
  deleteAttachment: (id: number) => apiClient.delete(`/mail/attachments/${id}`),
  
  // Unread count
  getUnreadCount: () => apiClient.get('/mail/unread-count'),
};
```

## 5. Backend Implementation

### 5.1 Mail Routes Structure
```typescript
// src/routes/mail.ts
import express from 'express';
import { mailService } from '../services/mailService.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Folder routes
router.get('/inbox', async (req, res) => {
  const { page = 1, limit = 20, search, label, unread, hasAttachment, today } = req.query;
  const result = await mailService.getInbox({
    page: Number(page),
    limit: Number(limit),
    search: search as string,
    labelId: label ? Number(label) : undefined,
    unread: unread === 'true',
    hasAttachment: hasAttachment === 'true',
    today: today === 'true',
  });
  res.json(result);
});

router.get('/sent', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await mailService.getSent({
    page: Number(page),
    limit: Number(limit),
  });
  res.json(result);
});

// ... other routes
```

### 5.2 Mail Service Methods
```typescript
// src/services/mailService.ts
export class MailService {
  // Get inbox with filters
  async getInbox(params: InboxParams): Promise<MailResult> {
    const { page, limit, search, labelId, unread, hasAttachment, today } = params;
    
    // Build query based on filters
    let query = 'SELECT * FROM emails WHERE folder = ?';
    const queryParams: any[] = ['inbox'];
    
    if (search) {
      query += ' AND (subject LIKE ? OR from_address LIKE ? OR body LIKE ?)';
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }
    
    if (unread) {
      query += ' AND is_read = 0';
    }
    
    if (hasAttachment) {
      query += ' AND has_attachments = 1';
    }
    
    if (today) {
      query += ' AND DATE(created_at) = DATE("now")';
    }
    
    // Add label filter if specified
    if (labelId) {
      query += ' AND id IN (SELECT email_id FROM email_label_mappings WHERE label_id = ?)';
      queryParams.push(labelId);
    }
    
    // Add pagination
    const offset = (page - 1) * limit;
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);
    
    // Execute query
    const emails = await this.db.all(query, queryParams);
    
    // Get total count for pagination
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const { total } = await this.db.get(countQuery, queryParams.slice(0, -2));
    
    return {
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  
  // Send email via SMTP
  async sendEmail(data: ComposeEmail): Promise<SendResult> {
    const { to, cc, bcc, subject, body, bodyHtml, attachments } = data;
    
    // Prepare email options
    const mailOptions: SendMailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : undefined,
      bcc: bcc.length ? bcc.join(', ') : undefined,
      subject,
      text: body,
      html: bodyHtml || body,
      attachments: await this.processAttachments(attachments),
    };
    
    // Send via SMTP
    const result = await this.smtpTransporter.sendMail(mailOptions);
    
    // Store in sent_emails table
    await this.db.run(
      `INSERT INTO sent_emails (to_addresses, cc_addresses, bcc_addresses, subject, body, body_html, attachments, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sent')`,
      [JSON.stringify(to), JSON.stringify(cc), JSON.stringify(bcc), subject, body, bodyHtml, JSON.stringify(attachments)]
    );
    
    return { success: true, messageId: result.messageId };
  }
}
```

## 6. Performance Considerations

### 6.1 Virtualized List
- Use `react-window` or `react-virtualized` for mail list
- Render only visible items (buffer of 5 items above/below)
- Lazy load email bodies on selection

### 6.2 Caching Strategy
- Cache email list for 5 minutes
- Cache individual emails for 1 hour
- Invalidate cache on send/delete/move

### 6.3 Pagination
- Server-side pagination (20 items per page)
- Infinite scroll option for mobile
- Prefetch next page when 3 items from end

## 7. Accessibility

### 7.1 Keyboard Navigation
- `↑/↓` - Navigate email list
- `Enter` - Open selected email
- `Delete` - Move to trash
- `R` - Reply
- `F` - Forward
- `C` - Compose new
- `Esc` - Close modals

### 7.2 ARIA Labels
- All interactive elements have aria-labels
- Live regions for status updates
- Proper heading hierarchy

## 8. Testing Strategy

### 8.1 Unit Tests
- Component rendering
- State management
- API service methods

### 8.2 Integration Tests
- Mail list selection
- Compose and send flow
- Search and filter operations

### 8.3 E2E Tests
- Complete email workflow
- Multi-folder navigation
- Label management

This specification provides a complete blueprint for implementing the enhanced mail client with pharmacy-specific workflows.