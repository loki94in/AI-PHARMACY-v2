---
name: mail-page-workflow-design
description: Comprehensive mail page and workflow design for AI Pharmacy OS - full email client with compose, send, folders, search, and pharmacy-specific workflows.
metadata:
  type: project
---

# Mail Page & Workflow Design — AI Pharmacy OS

## 1. Current State Analysis

### Existing Mail System
- **Frontend:** `Mail.tsx` (402 lines) - Basic inbox parser with 2 tabs (Inbox/Attachments)
- **Backend:** `emailService.ts` (915 lines) - IMAP polling, SMTP sending, order detection
- **Routes:** `email.ts` (151 lines) - 5 endpoints for inbox, import, attachments
- **Dependencies:** `imap-simple`, `mailparser`, `nodemailer`

### Current Limitations
1. **No compose/send UI** - Backend supports SMTP but frontend lacks compose functionality
2. **No folder system** - Only inbox view, no Sent/Drafts/Trash folders
3. **No search/filter** - Cannot search emails by sender, subject, or content
4. **No read/unread status** - All emails appear same visually
5. **Limited detail view** - Plain text only, no HTML rendering or attachment previews
6. **No mail workflows** - No integration with pharmacy operations beyond order detection

## 2. Proposed Mail Page Design

### 2.1 Enhanced Mail Page Layout
```
┌─────────────────────────────────────────────────────────────┐
│  MAIL CLIENT HEADER                                         │
│  [Status Badge] [Search Bar____________] [Compose] [Sync]  │
├─────────────┬───────────────────────────────────────────────┤
│  FOLDERS    │  MAIL LIST                    │  MAIL DETAIL  │
│  ─────────  │  ────────────────────────     │  ──────────── │
│  ● Inbox(3) │  From: Distributor A          │  From: ...    │
│  ○ Sent     │  Subject: Invoice #1234       │  Subject: ... │
│  ○ Drafts   │  Preview: Medicines list...   │  Date: ...    │
│  ○ Trash    │  ────────────────────────     │               │
│  ─────────  │  From: Customer B             │  [Body HTML]  │
│  Labels     │  Subject: Order confirmation  │               │
│  ■ Orders   │  Preview: Thank you for...    │  [Attachments]│
│  ■ Invoices │  ────────────────────────     │               │
│  ■ Alerts   │  From: System                │  [Reply]      │
│             │  Subject: Low stock alert     │  [Forward]    │
│             │  Preview: Item X below...     │  [Delete]     │
└─────────────┴───────────────────────────────────────────────┘
```

### 2.2 Mail Page Features

#### A. Folder System
1. **Inbox** - Received emails (IMAP synced)
2. **Sent** - Outgoing emails (SMTP sent)
3. **Drafts** - Saved unsent emails
4. **Trash** - Deleted emails (30-day retention)
5. **Labels** - Custom folders (Orders, Invoices, Alerts, etc.)

#### B. Compose/Reply/Forward
1. **Compose Modal** - Full editor with:
   - To/Cc/Bcc fields with autocomplete from contacts
   - Subject line
   - Rich text editor (bold, italic, lists, links)
   - Attachment upload (drag & drop)
   - Template support (order confirmation, inquiry, etc.)
   - Save as draft functionality

2. **Reply/Forward** - Pre-filled with original content

#### C. Search & Filter
1. **Global Search** - Search across all folders
2. **Advanced Filters**:
   - Date range picker
   - Sender/recipient filter
   - Has attachment filter
   - Read/Unread status
   - Label/tag filter

#### D. Mail Detail View
1. **HTML Rendering** - Sandboxed iframe for HTML emails
2. **Attachment Preview** - Inline images, PDF viewer, CSV/Excel preview
3. **Action Buttons**:
   - Reply / Reply All / Forward
   - Delete / Archive
   - Mark as Read/Unread
   - Add to Label/Move to Folder
   - Print / Download

#### E. Real-time Updates
1. **SSE Integration** - Live inbox updates via `/api/notifications/stream`
2. **Unread Counter** - Badge on mail icon in sidebar
3. **Desktop Notifications** - Optional browser notifications for new emails

## 3. Mail Workflow Design

### 3.1 Pharmacy-Specific Workflows

#### A. Order Confirmation Workflow
```
Trigger: New order received (email/WhatsApp/manual)
↓
1. Extract order details (medicine, quantity, patient)
↓
2. Check inventory availability
↓
3. Generate order confirmation email
↓
4. Send to customer via email/SMS
↓
5. Update order status in database
↓
6. Notify pharmacist via dashboard alert
```

#### B. Distributor Inquiry Workflow
```
Trigger: Inquiry email from distributor
↓
1. Parse inquiry (product list, pricing request)
↓
2. Match with current inventory & pricing
↓
3. Generate response with:
   - Available stock levels
   - Current pricing
   - Estimated delivery time
↓
4. Send response email
↓
5. Log interaction in CRM
```

#### C. Prescription refill Reminder Workflow
```
Trigger: Customer prescription refill due (based on purchase history)
↓
1. Calculate refill date (purchase date + duration)
↓
2. Generate personalized reminder
↓
3. Send via preferred channel (email/WhatsApp/SMS)
↓
4. Track response (refill ordered/deferred)
↓
5. Update CRM with reminder status
```

#### D. Low Stock Alert Workflow
```
Trigger: Inventory item below reorder level
↓
1. Identify affected medicines
↓
2. Find relevant distributors
↓
3. Generate purchase order email
↓
4. Send to distributor
↓
5. Track order confirmation
↓
6. Update inventory forecast
```

#### E. Expiry Alert Workflow
```
Trigger: Medicine approaching expiry (90/60/30 days)
↓
1. Generate expiry alert report
↓
2. Send to pharmacist email
↓
3. Option to:
   - Return to distributor (if returnable)
   - Discount for quick sale
   - Discard with documentation
↓
4. Update inventory status
```

### 3.2 Email Templates

#### A. Order Confirmation Template
```
Subject: Order #{{order_id}} Confirmed - {{pharmacy_name}}

Dear {{customer_name}},

Your order has been confirmed:

{{#items}}
- {{medicine_name}} ({{quantity}} units) - ₹{{price}}
{{/items}}

Total: ₹{{total}}
Payment: {{payment_method}}
Expected Delivery: {{delivery_date}}

Track your order: {{tracking_url}}

Thank you,
{{pharmacy_name}}
```

#### B. Distributor Inquiry Template
```
Subject: Re: Product Inquiry - {{pharmacy_name}}

Dear {{distributor_name}},

Thank you for your inquiry. Here are the available products:

{{#products}}
- {{product_name}}: {{stock_status}} @ ₹{{price}}/unit
{{/products}}

For bulk orders, please contact us at {{phone}}.

Best regards,
{{pharmacy_name}}
```

#### C. Prescription Refill Reminder
```
Subject: Time to refill your prescription - {{pharmacy_name}}

Dear {{customer_name}},

Your prescription for {{medicine_name}} is due for refill.

Last purchased: {{last_purchase_date}}
Duration: {{duration_days}} days
Refill due: {{refill_date}}

To reorder, simply reply to this email or visit our store.

Stay healthy,
{{pharmacy_name}}
```

## 4. Technical Implementation Plan

### 4.1 Database Schema Changes

#### A. Add `sent_emails` table
```sql
CREATE TABLE sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addresses TEXT NOT NULL,  -- JSON array
  cc_addresses TEXT,           -- JSON array
  bcc_addresses TEXT,          -- JSON array
  subject TEXT NOT NULL,
  body TEXT,
  body_html TEXT,
  attachments TEXT,            -- JSON array of file paths
  template_id INTEGER,
  status ENUM('sent', 'failed', 'draft') DEFAULT 'sent',
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,         -- User ID
  FOREIGN KEY (template_id) REFERENCES email_templates(id)
);
```

#### B. Add `email_templates` table
```sql
CREATE TABLE email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  body_html_template TEXT,
  category ENUM('order', 'inquiry', 'reminder', 'alert', 'custom') DEFAULT 'custom',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### C. Add `email_labels` table
```sql
CREATE TABLE email_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3B82F6',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### D. Add `email_label_mappings` table
```sql
CREATE TABLE email_label_mappings (
  email_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (email_id, label_id),
  FOREIGN KEY (email_id) REFERENCES action_logs(id),
  FOREIGN KEY (label_id) REFERENCES email_labels(id)
);
```

### 4.2 Backend API Endpoints

#### A. Mail CRUD Operations
```
GET    /api/mail/inbox          - Fetch inbox emails (with pagination, search, filters)
GET    /api/mail/sent           - Fetch sent emails
GET    /api/mail/drafts         - Fetch draft emails
GET    /api/mail/trash          - Fetch trash emails
GET    /api/mail/:id            - Get single email details
POST   /api/mail/send           - Send email
POST   /api/mail/draft          - Save as draft
PUT    /api/mail/:id            - Update email (mark read/unread, move to folder)
DELETE /api/mail/:id            - Move to trash
DELETE /api/mail/:id/permanent  - Permanent delete
```

#### B. Search & Filter
```
GET    /api/mail/search         - Search emails with query params
       ?q=search_term
       &from=email@example.com
       &subject=invoice
       &hasAttachment=true
       &label=orders
       &startDate=2024-01-01
       &endDate=2024-12-31
       &status=unread
```

#### C. Labels Management
```
GET    /api/mail/labels         - Get all labels
POST   /api/mail/labels         - Create new label
PUT    /api/mail/labels/:id     - Update label
DELETE /api/mail/labels/:id     - Delete label
POST   /api/mail/:id/labels     - Add label to email
DELETE /api/mail/:id/labels/:labelId - Remove label from email
```

#### D. Templates Management
```
GET    /api/mail/templates      - Get all templates
POST   /api/mail/templates      - Create new template
PUT    /api/mail/templates/:id  - Update template
DELETE /api/mail/templates/:id  - Delete template
POST   /api/mail/templates/:id/render - Render template with data
```

#### E. Attachments
```
POST   /api/mail/attachments/upload - Upload attachment
GET    /api/mail/attachments/:id    - Download attachment
DELETE /api/mail/attachments/:id    - Delete attachment
```

### 4.3 Frontend Components

#### A. Mail Page Structure
```
frontend/src/pages/Mail.tsx (enhanced)
├── MailHeader.tsx           - Search, compose, sync buttons
├── MailSidebar.tsx          - Folder tree, labels, filters
├── MailList.tsx             - Email list with pagination
├── MailListItem.tsx         - Individual email row
├── MailDetail.tsx           - Email viewer with actions
├── ComposeModal.tsx         - Email composer
├── TemplateSelector.tsx     - Template picker
├── AttachmentUploader.tsx   - Drag & drop uploads
└── MailSettings.tsx         - IMAP/SMTP configuration
```

#### B. Component Responsibilities

1. **MailHeader.tsx**
   - Global search input with debounce
   - Compose button (opens ComposeModal)
   - Sync button (triggers IMAP poll)
   - Unread count badge

2. **MailSidebar.tsx**
   - Folder tree (Inbox, Sent, Drafts, Trash)
   - Label list with color indicators
   - Quick filters (Unread, Has Attachment, Today)

3. **MailList.tsx**
   - Virtualized list for performance
   - Multi-select with checkboxes
   - Bulk actions (delete, move, mark read/unread)
   - Infinite scroll pagination

4. **MailListItem.tsx**
   - Sender avatar/initials
   - Subject line (bold if unread)
   - Preview text (truncated)
   - Date/time (relative: "2h ago", "Yesterday")
   - Attachment icon
   - Label color dots

5. **MailDetail.tsx**
   - HTML email rendering (sandboxed iframe)
   - Attachment gallery with previews
   - Action toolbar (Reply, Forward, Delete, etc.)
   - Metadata panel (from, to, date, etc.)

6. **ComposeModal.tsx**
   - To/Cc/Bcc fields with autocomplete
   - Subject input
   - Rich text editor (TipTap or similar)
   - Attachment dropzone
   - Template selector dropdown
   - Send / Save Draft / Discard buttons

### 4.4 Integration Points

#### A. With Existing Systems
1. **Order Detection** - Enhance to create draft replies
2. **CRM** - Log email interactions in customer history
3. **Inventory** - Auto-attach stock reports to inquiry replies
4. **Dashboard** - Show unread count, recent activity
5. **Notifications** - SSE for real-time updates

#### B. With External Services
1. **IMAP/SMTP** - Gmail, Outlook, custom providers
2. **WhatsApp** - Send emails via WhatsApp as fallback
3. **SMS** - Critical alerts via SMS
4. **Cloud Storage** - Attach files from Google Drive, Dropbox

## 5. UI/UX Design Specifications

### 5.1 Color Scheme (Dark Theme)
```css
:root {
  --mail-bg: #0f0f11;
  --mail-surface: #18181b;
  --mail-border: #27272a;
  --mail-text: #fafafa;
  --mail-muted: #a1a1aa;
  --mail-primary: #3b82f6;
  --mail-success: #22c55e;
  --mail-warning: #f59e0b;
  --mail-danger: #ef4444;
  --mail-unread: #3b82f6;
  --mail-selected: rgba(59, 130, 246, 0.1);
}
```

### 5.2 Responsive Breakpoints
```css
/* Mobile: Single column, collapsible sidebar */
@media (max-width: 768px) {
  .mail-layout { grid-template-columns: 1fr; }
  .mail-sidebar { display: none; }
  .mail-detail { position: fixed; inset: 0; }
}

/* Tablet: Two columns */
@media (min-width: 769px) and (max-width: 1024px) {
  .mail-layout { grid-template-columns: 250px 1fr; }
  .mail-detail { position: fixed; right: 0; top: 0; bottom: 0; width: 400px; }
}

/* Desktop: Three columns */
@media (min-width: 1025px) {
  .mail-layout { grid-template-columns: 250px 1fr 1fr; }
}
```

### 5.3 Animations
```css
/* Email item hover */
.mail-item:hover {
  background: rgba(255, 255, 255, 0.05);
  transform: translateX(2px);
}

/* Compose modal entrance */
.compose-modal {
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Unread indicator pulse */
.unread-dot {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

## 6. Implementation Phases

### Phase 1: Core Mail Client (Week 1-2)
1. Database schema updates
2. Backend API for CRUD operations
3. Frontend mail page with folders
4. Basic compose/send functionality
5. IMAP/SMTP configuration panel

### Phase 2: Enhanced Features (Week 3-4)
1. Search and filtering
2. Labels and organization
3. HTML email rendering
4. Attachment management
5. Real-time updates via SSE

### Phase 3: Pharmacy Workflows (Week 5-6)
1. Email templates system
2. Order confirmation workflow
3. Distributor inquiry automation
4. Prescription refill reminders
5. Low stock alert emails

### Phase 4: Polish & Optimization (Week 7-8)
1. Performance optimization (virtualized lists)
2. Mobile responsiveness
3. Keyboard shortcuts
4. Accessibility (ARIA labels, screen reader support)
5. Unit and integration tests

## 7. Success Metrics

### 7.1 Functional Metrics
- **Email Delivery Rate:** >99% success
- **IMAP Sync Time:** <30 seconds for 100 emails
- **Search Response Time:** <500ms for 10k emails
- **Compose to Send:** <2 seconds

### 7.2 User Experience Metrics
- **Task Completion Rate:** >95% for common tasks
- **Error Rate:** <1% for email operations
- **User Satisfaction:** >4.5/5 rating

### 7.3 Business Metrics
- **Order Processing Time:** Reduced by 30%
- **Customer Response Time:** Reduced by 50%
- **Email Template Usage:** >80% of outgoing emails
- **Workflow Automation:** 40% reduction in manual tasks

## 8. Risks & Mitigations

### 8.1 Technical Risks
1. **IMAP/SMTP Compatibility** - Test with major providers (Gmail, Outlook, Yahoo)
2. **Large Attachment Handling** - Implement chunked uploads, size limits
3. **HTML Email Security** - Sandbox iframe, sanitize content
4. **Performance with Large Mailboxes** - Implement pagination, lazy loading

### 8.2 User Adoption Risks
1. **Complexity** - Provide onboarding tour, tooltips
2. **Migration from External Clients** - Import/export functionality
3. **Training** - Create video tutorials, documentation

## 9. Future Enhancements

### 9.1 AI-Powered Features
1. **Smart Compose** - AI suggestions while typing
2. **Auto-categorize** - ML-based email classification
3. **Sentiment Analysis** - Detect customer satisfaction
4. **Priority Scoring** - Auto-prioritize urgent emails

### 9.2 Advanced Integrations
1. **Calendar Integration** - Schedule meetings from emails
2. **Task Management** - Convert emails to tasks
3. **Document Management** - Auto-extract and file attachments
4. **Analytics Dashboard** - Email metrics and insights

## 10. Conclusion

This design transforms the basic email parser into a comprehensive mail client tailored for pharmacy operations. The phased approach ensures incremental delivery while maintaining system stability. The pharmacy-specific workflows will significantly improve operational efficiency and customer communication.

**Next Steps:**
1. Review design with stakeholders
2. Finalize technical specifications
3. Begin Phase 1 implementation
4. Set up development environment
5. Create test plan