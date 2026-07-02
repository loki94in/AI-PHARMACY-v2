---
name: mail-implementation-quickstart
description: Quick start guide for implementing the enhanced mail page - step-by-step implementation plan with code examples.
metadata:
  type: project
---

# Mail Page Implementation Quick Start

## 1. Implementation Overview

This guide provides a step-by-step implementation plan for enhancing the mail page from a basic inbox parser to a full-featured mail client with pharmacy-specific workflows.

**Estimated Time:** 2-3 weeks for core features  
**Difficulty:** Intermediate  
**Prerequisites:** Existing AI Pharmacy OS setup

## 2. Phase 1: Database Schema Updates (Day 1)

### 2.1 Create New Tables
```sql
-- File: src/database.ts (add to ensureSchema function)

// Sent emails table
CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addresses TEXT NOT NULL,
  cc_addresses TEXT,
  bcc_addresses TEXT,
  subject TEXT NOT NULL,
  body TEXT,
  body_html TEXT,
  attachments TEXT,
  template_id INTEGER,
  status TEXT DEFAULT 'sent',
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY (template_id) REFERENCES email_templates(id)
);

// Email templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  body_html_template TEXT,
  category TEXT DEFAULT 'custom',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

// Email labels table
CREATE TABLE IF NOT EXISTS email_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3B82F6',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

// Email-label mappings
CREATE TABLE IF NOT EXISTS email_label_mappings (
  email_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (email_id, label_id),
  FOREIGN KEY (email_id) REFERENCES action_logs(id),
  FOREIGN KEY (label_id) REFERENCES email_labels(id)
);

// Add folder and read status to action_logs
ALTER TABLE action_logs ADD COLUMN folder TEXT DEFAULT 'inbox';
ALTER TABLE action_logs ADD COLUMN is_read INTEGER DEFAULT 0;
ALTER TABLE action_logs ADD COLUMN has_attachments INTEGER DEFAULT 0;
```

### 2.2 Migration Script
```bash
# Run this command to apply schema changes
npm run migrate:mail
```

## 3. Phase 2: Backend API (Days 2-4)

### 3.1 Create Mail Routes
```typescript
// File: src/routes/mail.ts (new file)
import express from 'express';
import { mailService } from '../services/mailService.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Get inbox with filters
router.get('/inbox', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, label, unread, hasAttachment } = req.query;
    const result = await mailService.getInbox({
      page: Number(page),
      limit: Number(limit),
      search: search as string,
      labelId: label ? Number(label) : undefined,
      unread: unread === 'true',
      hasAttachment: hasAttachment === 'true',
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// Send email
router.post('/send', async (req, res) => {
  try {
    const { to, cc, bcc, subject, body, bodyHtml, attachments } = req.body;
    const result = await mailService.sendEmail({
      to, cc, bcc, subject, body, bodyHtml, attachments
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Search emails
router.get('/search', async (req, res) => {
  try {
    const { q, from, subject, hasAttachment, label, startDate, endDate } = req.query;
    const results = await mailService.search({
      query: q as string,
      from: from as string,
      subject: subject as string,
      hasAttachment: hasAttachment === 'true',
      labelId: label ? Number(label) : undefined,
      startDate: startDate as string,
      endDate: endDate as string,
    });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search emails' });
  }
});

// ... other routes (labels, templates, attachments)

export default router;
```

### 3.2 Create Mail Service
```typescript
// File: src/services/mailService.ts (new file)
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { createTransport, Transporter } from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export class MailService {
  private smtpTransporter: Transporter | null = null;

  constructor() {
    // Initialize SMTP transporter
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.smtpTransporter = createTransport({
        host: process.env.SMTP_HOST || '',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  }

  async getInbox(params: InboxParams): Promise<MailResult> {
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    try {
      let query = 'SELECT * FROM action_logs WHERE action_type = ? AND folder = ?';
      const queryParams: any[] = ['EMAIL_RECEIVED', 'inbox'];

      // Add filters
      if (params.search) {
        query += ' AND (description LIKE ?)';
        queryParams.push(`%${params.search}%`);
      }

      if (params.unread) {
        query += ' AND is_read = 0';
      }

      // Add pagination
      const offset = (params.page - 1) * params.limit;
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      queryParams.push(params.limit, offset);

      const emails = await db.all(query, queryParams);
      const { total } = await db.get(
        'SELECT COUNT(*) as total FROM action_logs WHERE action_type = ? AND folder = ?',
        ['EMAIL_RECEIVED', 'inbox']
      );

      return {
        emails,
        pagination: {
          page: params.page,
          limit: params.limit,
          total,
          totalPages: Math.ceil(total / params.limit),
        },
      };
    } finally {
      await db.close();
    }
  }

  async sendEmail(data: ComposeEmail): Promise<SendResult> {
    if (!this.smtpTransporter) {
      throw new Error('SMTP not configured');
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: data.to.join(', '),
      cc: data.cc.length ? data.cc.join(', ') : undefined,
      bcc: data.bcc.length ? data.bcc.join(', ') : undefined,
      subject: data.subject,
      text: data.body,
      html: data.bodyHtml || data.body,
    };

    const result = await this.smtpTransporter.sendMail(mailOptions);

    // Store in sent_emails table
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    try {
      await db.run(
        `INSERT INTO sent_emails (to_addresses, cc_addresses, bcc_addresses, subject, body, body_html, status)
         VALUES (?, ?, ?, ?, ?, ?, 'sent')`,
        [JSON.stringify(data.to), JSON.stringify(data.cc), JSON.stringify(data.bcc), 
         data.subject, data.body, data.bodyHtml]
      );
    } finally {
      await db.close();
    }

    return { success: true, messageId: result.messageId };
  }
}

export const mailService = new MailService();
```

### 3.3 Register Routes
```typescript
// File: src/server.ts (add to imports and app.use)
import mailRouter from './routes/mail.js';

// Add to app.use section
app.use('/api/mail', mailRouter);
```

## 4. Phase 3: Frontend Components (Days 5-10)

### 4.1 Create Mail Components Directory
```bash
mkdir -p frontend/src/components/mail
```

### 4.2 Create MailHeader Component
```tsx
// File: frontend/src/components/mail/MailHeader.tsx
import { useState, useEffect } from 'react';
import { Mail as MailIcon, RefreshCw, Search, Compose } from 'lucide-react';
import { api } from '../../services/api';

interface MailHeaderProps {
  onCompose: () => void;
  onSync: () => void;
  isSyncing: boolean;
}

const MailHeader = ({ onCompose, onSync, isSyncing }: MailHeaderProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Fetch unread count
    api.getUnreadCount().then((data: any) => {
      setUnreadCount(data.count || 0);
    });
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement search functionality
    console.log('Searching for:', searchQuery);
  };

  return (
    <div className="glass-panel p-4 flex flex-wrap items-center justify-between gap-4 bg-white/5 border-glass-border">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
          <MailIcon size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-text">Mail Client</h3>
          <p className="text-xs text-muted">
            {unreadCount > 0 ? `${unreadCount} unread emails` : 'All caught up'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Search Input */}
        <form onSubmit={handleSearch} className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="premium-input pl-9 pr-4 py-2 text-xs w-64"
          />
        </form>

        {/* Sync Button */}
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-glass-border/60 text-text transition-all flex items-center gap-2 text-xs font-semibold"
        >
          <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
          Sync
        </button>

        {/* Compose Button */}
        <button
          onClick={onCompose}
          className="premium-btn bg-primary text-text shadow-[0_4px_12px_rgba(59,130,246,0.3)] hover:bg-blue-600 text-xs py-2 px-4 font-bold uppercase tracking-wider flex items-center gap-2"
        >
          <Compose size={14} />
          Compose
        </button>
      </div>
    </div>
  );
};

export default MailHeader;
```

### 4.3 Create MailSidebar Component
```tsx
// File: frontend/src/components/mail/MailSidebar.tsx
import { useState, useEffect } from 'react';
import { 
  Inbox, Send, FileText, Trash2, Tag, Plus, 
  Mail, Paperclip, Calendar 
} from 'lucide-react';
import { api } from '../../services/api';

interface MailSidebarProps {
  activeFolder: string;
  onFolderChange: (folder: string) => void;
  activeLabelId?: number;
  onLabelClick: (labelId: number) => void;
}

const MailSidebar = ({ 
  activeFolder, 
  onFolderChange, 
  activeLabelId, 
  onLabelClick 
}: MailSidebarProps) => {
  const [labels, setLabels] = useState<any[]>([]);
  const [unreadCounts, setUnreadCounts] = useState({
    inbox: 0,
    sent: 0,
    drafts: 0,
    trash: 0,
  });

  useEffect(() => {
    // Fetch labels
    api.getLabels().then((data: any) => {
      setLabels(data || []);
    });

    // Fetch unread counts
    api.getUnreadCount().then((data: any) => {
      setUnreadCounts(prev => ({
        ...prev,
        inbox: data.inbox || 0,
        sent: data.sent || 0,
        drafts: data.drafts || 0,
        trash: data.trash || 0,
      }));
    });
  }, []);

  const folders = [
    { id: 'inbox', name: 'Inbox', icon: Inbox, count: unreadCounts.inbox },
    { id: 'sent', name: 'Sent', icon: Send, count: unreadCounts.sent },
    { id: 'drafts', name: 'Drafts', icon: FileText, count: unreadCounts.drafts },
    { id: 'trash', name: 'Trash', icon: Trash2, count: unreadCounts.trash },
  ];

  return (
    <div className="glass-panel w-64 bg-white/5 border-glass-border flex flex-col h-full">
      {/* Folders Section */}
      <div className="p-4 border-b border-glass-border">
        <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Folders</h4>
        <div className="space-y-1">
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => onFolderChange(folder.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeFolder === folder.id
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'text-muted hover:text-text hover:bg-white/5'
              }`}
            >
              <folder.icon size={16} />
              <span className="flex-1 text-left">{folder.name}</span>
              {folder.count > 0 && (
                <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold">
                  {folder.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Labels Section */}
      <div className="p-4 border-b border-glass-border">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Labels</h4>
          <button className="text-primary hover:text-blue-400 transition-colors">
            <Plus size={14} />
          </button>
        </div>
        <div className="space-y-1">
          {labels.map((label) => (
            <button
              key={label.id}
              onClick={() => onLabelClick(label.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeLabelId === label.id
                  ? 'bg-white/10 text-text'
                  : 'text-muted hover:text-text hover:bg-white/5'
              }`}
            >
              <div 
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="flex-1 text-left">{label.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick Filters */}
      <div className="p-4">
        <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Quick Filters</h4>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-muted hover:text-text cursor-pointer">
            <input type="checkbox" className="premium-input" />
            <Mail size={12} />
            Unread only
          </label>
          <label className="flex items-center gap-2 text-xs text-muted hover:text-text cursor-pointer">
            <input type="checkbox" className="premium-input" />
            <Paperclip size={12} />
            Has attachment
          </label>
          <label className="flex items-center gap-2 text-xs text-muted hover:text-text cursor-pointer">
            <input type="checkbox" className="premium-input" />
            <Calendar size={12} />
            Today only
          </label>
        </div>
      </div>
    </div>
  );
};

export default MailSidebar;
```

### 4.4 Update Mail Page
```tsx
// File: frontend/src/pages/Mail.tsx (update existing)
import { useState, useEffect } from 'react';
import MailHeader from '../components/mail/MailHeader';
import MailSidebar from '../components/mail/MailSidebar';
import MailList from '../components/mail/MailList';
import MailDetail from '../components/mail/MailDetail';
import ComposeModal from '../components/mail/ComposeModal';
import { api } from '../services/api';

const Mail = () => {
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [composeMode, setComposeMode] = useState('new');

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const data = await api.getInbox({ folder: activeFolder });
      setEmails(data.emails || []);
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, [activeFolder]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      // Trigger IMAP sync
      await api.syncMailbox();
      await fetchEmails();
    } catch (error) {
      console.error('Error syncing:', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleCompose = () => {
    setComposeMode('new');
    setShowComposeModal(true);
  };

  return (
    <div className="h-full flex flex-col fade-in space-y-5 overflow-hidden pb-4">
      <MailHeader 
        onCompose={handleCompose}
        onSync={handleSync}
        isSyncing={syncing}
      />

      <div className="flex-1 flex gap-5 overflow-hidden">
        <MailSidebar
          activeFolder={activeFolder}
          onFolderChange={setActiveFolder}
        />

        <div className="flex-1 flex gap-5 overflow-hidden">
          <MailList
            emails={emails}
            selectedId={selectedEmail?.id}
            onSelect={setSelectedEmail}
            loading={loading}
          />

          <MailDetail
            email={selectedEmail}
            onReply={() => {
              setComposeMode('reply');
              setShowComposeModal(true);
            }}
            onForward={() => {
              setComposeMode('forward');
              setShowComposeModal(true);
            }}
          />
        </div>
      </div>

      {showComposeModal && (
        <ComposeModal
          isOpen={showComposeModal}
          onClose={() => setShowComposeModal(false)}
          mode={composeMode}
          replyToEmail={composeMode === 'reply' ? selectedEmail : null}
          forwardEmail={composeMode === 'forward' ? selectedEmail : null}
        />
      )}
    </div>
  );
};

export default Mail;
```

## 5. Phase 4: Advanced Features (Days 11-15)

### 5.1 Implement Search Functionality
```typescript
// Add to mailService.ts
async search(params: SearchParams): Promise<SearchResult> {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    let query = 'SELECT * FROM action_logs WHERE action_type = ?';
    const queryParams: any[] = ['EMAIL_RECEIVED'];

    if (params.query) {
      query += ' AND (description LIKE ? OR subject LIKE ?)';
      const searchPattern = `%${params.query}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    if (params.from) {
      query += ' AND from_address LIKE ?';
      queryParams.push(`%${params.from}%`);
    }

    // ... other filters

    const emails = await db.all(query, queryParams);
    return { emails, total: emails.length };
  } finally {
    await db.close();
  }
}
```

### 5.2 Implement Labels Management
```typescript
// Add to mailService.ts
async createLabel(data: CreateLabelData): Promise<Label> {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    const result = await db.run(
      'INSERT INTO email_labels (name, color) VALUES (?, ?)',
      [data.name, data.color]
    );
    return { id: result.lastID, ...data };
  } finally {
    await db.close();
  }
}

async addLabelToEmail(emailId: number, labelId: number): Promise<void> {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    await db.run(
      'INSERT OR IGNORE INTO email_label_mappings (email_id, label_id) VALUES (?, ?)',
      [emailId, labelId]
    );
  } finally {
    await db.close();
  }
}
```

### 5.3 Implement Email Templates
```typescript
// Add to mailService.ts
async renderTemplate(templateId: number, data: any): Promise<TemplateRender> {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    const template = await db.get(
      'SELECT * FROM email_templates WHERE id = ?',
      [templateId]
    );

    if (!template) {
      throw new Error('Template not found');
    }

    // Simple template rendering (replace {{variable}} placeholders)
    let subject = template.subject_template;
    let body = template.body_template;

    Object.keys(data).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      subject = subject.replace(regex, data[key]);
      body = body.replace(regex, data[key]);
    });

    return { subject, body };
  } finally {
    await db.close();
  }
}
```

## 6. Testing Checklist

### 6.1 Backend Tests
- [ ] Test inbox retrieval with filters
- [ ] Test email sending via SMTP
- [ ] Test search functionality
- [ ] Test label creation and assignment
- [ ] Test template rendering

### 6.2 Frontend Tests
- [ ] Test mail list rendering
- [ ] Test email selection and detail view
- [ ] Test compose modal functionality
- [ ] Test search input and results
- [ ] Test folder navigation

### 6.3 Integration Tests
- [ ] Test complete compose → send workflow
- [ ] Test reply to email workflow
- [ ] Test label management workflow
- [ ] Test search and filter workflow

## 7. Deployment Steps

### 7.1 Database Migration
```bash
# Run migration script
npm run migrate:mail

# Verify tables created
sqlite3 data/app.db ".tables"
```

### 7.2 Environment Variables
```bash
# Add to .env file
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=Your Pharmacy <your-email@gmail.com>
```

### 7.3 Build and Deploy
```bash
# Build frontend
cd frontend && npm run build

# Restart server
npm start
```

## 8. Next Steps

After completing the core implementation:

1. **Add rich text editor** - Integrate TipTap or similar
2. **Implement HTML email rendering** - Sandboxed iframe
3. **Add attachment previews** - PDF viewer, CSV preview
4. **Implement pharmacy workflows** - Order confirmations, reminders
5. **Add keyboard shortcuts** - Power user features
6. **Mobile optimization** - Touch gestures, responsive design

## 9. Support

For questions or issues:
- Check the existing email service implementation
- Review the API documentation in `/docs/api`
- Test with mock data first before connecting to real SMTP

This quick start guide provides a practical implementation path. Start with Phase 1 and iterate through each phase.