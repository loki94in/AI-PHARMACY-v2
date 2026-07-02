# API Endpoints Reference

This document provides a comprehensive reference of all Express HTTP API endpoints available in the Pharmacy Genius OS.

---

## Global & Upload APIs

### Upload File
- **Endpoint:** `POST /api/upload`
- **Content-Type:** `multipart/form-data`
- **Request Parameters:**
  - `file`: The binary file (image/PDF) representing invoices or medicine labels to enqueue.
- **Description:** Uploads a file to the catalog directory, archives it using `imageArchiveService` (including checking for H1-Rx status), and enqueues a job in `catalog_jobs` for background OCR parsing.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "File uploaded and queued for processing",
    "file": "1716654890123-filename.jpg"
  }
  ```

### Get Extracted Medicines
- **Endpoint:** `GET /api/medicines`
- **Description:** Returns a list of all recognized medicines from the database.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 1,
      "name": "Paracetamol 500mg",
      "mrp": 15.5,
      "created_at": "2026-05-26T12:00:00.000Z"
    }
  ]
  ```

### Get Distributors
- **Endpoint:** `GET /api/distributors`
- **Description:** Returns a list of all distributors registered in the system.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 1,
      "name": "Cipla Logistics",
      "contact": null
    }
  ]
  ```

### Save Purchase (Legacy Endpoint)
- **Endpoint:** `POST /api/purchases`
- **Request Body:**
  ```json
  {
    "distributor": "Cipla Logistics",
    "invoice_no": "INV-1004",
    "total_amount": 2500
  }
  ```
- **Description:** Upserts the distributor and logs the purchase details.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Purchase saved"
  }
  ```

### Get Catalog Jobs
- **Endpoint:** `GET /api/jobs`
- **Description:** Returns all background file processing and migration jobs.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 1,
      "file_path": "catalog/1716654890123-filename.jpg",
      "status": "completed",
      "created_at": "2026-05-26T12:00:00.000Z"
    }
  ]
  ```

---

## Core Feature APIs

### Sales & Counter POS (`/api/sales`)

#### Get Next Sequential Invoice Number
- **Endpoint:** `GET /api/sales/next-invoice`
- **Description:** Computes the next invoice number based on the current calendar year (e.g., `S-2026-0001`).
- **Response (200 OK):**
  ```json
  {
    "invoice_no": "S-2026-0005"
  }
  ```

#### Create New Sale
- **Endpoint:** `POST /api/sales`
- **Request Body:**
  ```json
  {
    "items": [
      {
        "inventory_id": 12,
        "quantity": 2,
        "unit_price": 10.5
      }
    ],
    "patient_id": 3,
    "doctor_id": 1,
    "discount": 5.0
  }
  ```
- **Description:** Validates stock levels, decrements inventory, records the sale invoice, and saves line items.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "invoice_no": "S-2026-0005",
    "total": 17.05,
    "tax": 1.05
  }
  ```

#### Hold a Bill
- **Endpoint:** `POST /api/sales/hold`
- **Request Body:** The full cart and POS state structure.
- **Description:** Suspends a transaction, generating a hold invoice number so POS staff can recall it later.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Bill held",
    "invoice_no": "S-2026-0006"
  }
  ```

---

### Inventory Master (`/api/inventory`)

#### Get Inventory Master
- **Endpoint:** `GET /api/inventory`
- **Description:** Lists all inventory batch records with their corresponding medicine details.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 12,
      "medicine_id": 2,
      "medicine_name": "Amoxicillin 250mg",
      "quantity": 120,
      "rack_location": "B3",
      "batch_no": "AMX004",
      "expiry_date": "2027-12-01"
    }
  ]
  ```

#### Stock Override
- **Endpoint:** `POST /api/inventory/override`
- **Request Body:**
  ```json
  {
    "inventory_id": 12,
    "quantity": 100
  }
  ```
- **Description:** Directly overrides the stock level of a specific inventory batch.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Stock updated"
  }
  ```

#### Smart-Hover Peek (Price/Batch History)
- **Endpoint:** `GET /api/inventory/peek/:medicine_id`
- **Description:** Returns the 5 oldest batches for a medicine sorted by expiry date, helping staff compare costs and batch levels.
- **Response (200 OK):**
  ```json
  [
    {
      "batch_no": "AMX004",
      "expiry_date": "2027-12-01",
      "quantity": 120,
      "unit_price": 12.0,
      "cost_price": 8.5
    }
  ]
  ```

#### Update Inventory Record
- **Endpoint:** `PUT /api/inventory/:id`
- **Request Body:**
  ```json
  {
    "quantity": 150,
    "rack_location": "B4",
    "batch_no": "AMX004-R",
    "expiry_date": "2027-12-15",
    "reorder_level": 20
  }
  ```
- **Description:** Modifies details of a specific inventory item.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Inventory updated"
  }
  ```

#### Inventory Bulk Action
- **Endpoint:** `POST /api/inventory/bulk-action`
- **Request Body:**
  ```json
  {
    "action": "reorder",
    "ids": [12, 13, 14]
  }
  ```
- **Description:** Executes a bulk action (such as flagging for reorder or changing statuses) and registers it in the audit logs.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Bulk reorder completed and logged"
  }
  ```

---

### Dashboard Analytics (`/api/dashboard`)
- **Endpoint:** `GET /api/dashboard`
- **Description:** Aggregates quick status metrics (e.g. total sales, low stock alerts, pending orders).
- **Response (200 OK):** *(Structure varies depending on specific front-end requirements)*

---

### Purchases (`/api/purchases`)

#### List Purchase Invoices
- **Endpoint:** `GET /api/purchases`
- **Description:** Fetches all purchase orders and invoices matched to distributors.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 1,
      "invoice_no": "INV-1004",
      "date": "2026-05-26T12:00:00.000Z",
      "total_amount": 2500,
      "distributor_name": "Cipla Logistics"
    }
  ]
  ```

#### Update Purchase Invoice
- **Endpoint:** `PUT /api/purchases/:id`
- **Request Body:**
  ```json
  {
    "distributor": "Cipla Logistics New",
    "invoice_no": "INV-1004-REV",
    "total_amount": 2600
  }
  ```
- **Description:** Modifies an existing purchase order, updating the associated distributor dynamically.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Purchase updated"
  }
  ```

#### Purchase Bulk Action
- **Endpoint:** `POST /api/purchases/bulk-action`
- **Request Body:**
  ```json
  {
    "action": "approve",
    "ids": [1, 2]
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Bulk approve completed and logged"
  }
  ```

---

### Returns & AI Camera OCR (`/api/returns`)

#### List Returns
- **Endpoint:** `GET /api/returns`
- **Description:** Returns all sale and purchase returns records.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 1,
      "return_no": "RET-001",
      "original_invoice_id": 5,
      "type": "sale",
      "total_amount": 45.0,
      "date": "2026-05-26T12:00:00.000Z"
    }
  ]
  ```

#### Create Return
- **Endpoint:** `POST /api/returns`
- **Request Body:**
  ```json
  {
    "return_no": "RET-002",
    "original_invoice_id": 5,
    "type": "sale",
    "total_amount": 30.0
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Return recorded"
  }
  ```

#### Generate Financial Note PDF
- **Endpoint:** `POST /api/returns/financial-note`
- **Request Body:**
  ```json
  {
    "type": "credit",
    "amount": 250,
    "details": "Refund for damaged Paracetamol batch"
  }
  ```
- **Description:** Generates a credit/debit PDF note dynamically inside the `catalog/` directory using PDFKit.
- **Response (200 OK):**
  ```json
  {
    "url": "/catalog/financial-note-1716654890123.pdf",
    "message": "credit note generated"
  }
  ```

#### Process Label OCR (AI Camera)
- **Endpoint:** `POST /api/returns/ai-camera/process`
- **Request Body:**
  ```json
  {
    "image": "data:image/jpeg;base64,..."
  }
  ```
- **Description:** Takes a base64 encoded image of a medicine package, parses text via Tesseract OCR, and extracts potential medicine details (name, batch number, strength, expiry date, MRP).
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "ocrResult": {
      "text": "PARACETAMOL 500mg\nBATCH: PR999\nEXP: 12/28\nMRP: 20.00"
    },
    "medicineInfo": {
      "potentialName": "PARACETAMOL 500mg",
      "strength": "500mg",
      "batchNumber": "PR999",
      "expiryDate": "12/28",
      "mrp": 20.00
    },
    "message": "Image processed successfully"
  }
  ```

---

### Expiry Monitor (`/api/expiry`)
- **Endpoint:** `GET /api/expiry`
- **Description:** Lists all inventory batch items nearing expiry within the next 30 days.
- **Response (200 OK):**
  ```json
  [
    {
      "id": 12,
      "medicine_name": "Paracetamol 500mg",
      "expiry_date": "2026-06-15",
      "quantity": 40
    }
  ]
  ```

---

### Reports & PDF Exports (`/api/reports`)

#### Get Basic Reports Analytics
- **Endpoint:** `GET /api/reports`
- **Description:** Returns the total sales and purchases amounts logged in the system.
- **Response (200 OK):**
  ```json
  {
    "totalSales": 14500.5,
    "totalPurchases": 8900.0
  }
  ```

#### Export PDF Report
- **Endpoint:** `GET /api/reports/export-pdf`
- **Query Parameters:**
  - `type`: The type of report to export (`expiry` | `sales` | `logs` | `compliance`).
- **Description:** Stream-pipes a dynamically compiled PDF containing specific report records directly as a file download.
- **Response (200 OK):** File stream with header `Content-Type: application/pdf`.

---

## CRM & Messaging APIs

### CRM (`/api/crm`)

#### Get Customer Directory
- **Endpoint:** `GET /api/crm`
- **Response (200 OK):**
  ```json
  [
    {
      "id": 3,
      "name": "Jane Smith",
      "phone": "+919876543210",
      "address": "Delhi, India",
      "notes": "Prefers Cipla brand"
    }
  ]
  ```

#### Create Customer
- **Endpoint:** `POST /api/crm`
- **Request Body:**
  ```json
  {
    "name": "John Doe",
    "phone": "+919999999999",
    "address": "Mumbai, India",
    "notes": "Diabetic patient"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Customer created successfully"
  }
  ```

#### Get Customer Invoice History
- **Endpoint:** `GET /api/crm/:id/history`
- **Response (200 OK):**
  ```json
  [
    {
      "id": 12,
      "invoice_no": "S-2026-0002",
      "customer_id": 3,
      "total_amount": 145.0,
      "tax_amount": 7.25,
      "date": "2026-05-24T10:00:00.000Z"
    }
  ]
  ```

---

### Email Ingestion (`/api/email`)

#### Receive Webhook Email
- **Endpoint:** `POST /api/email`
- **Request Body:**
  ```json
  {
    "subject": "Purchase Invoice INV-99283",
    "from": "distributor@cipla.com",
    "body": "Hi, please find attached the invoice for order #2819.",
    "attachments": []
  }
  ```
- **Description:** Webhook to ingest and parse emails (including attachment CSVs/excels) via `EmailService`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Email received and processed"
  }
  ```

#### Get Inbox Logs
- **Endpoint:** `GET /api/email/inbox`
- **Query Parameters:**
  - `limit`: Number of records to return (default `20`).
- **Response (200 OK):** List of parsed inbox records and alerts.

#### Manually Import Email Payload
- **Endpoint:** `POST /api/email/import-manual`
- **Request Body:** Same format as `POST /api/email`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Invoice manually imported and delivery boy alerted"
  }
  ```

---

### App Settings (`/api/settings`)

#### Get Setting Value
- **Endpoint:** `GET /api/settings/:key`
- **Response (200 OK):**
  ```json
  {
    "key": "EMAIL_PARSER_ENABLED",
    "value": "true"
  }
  ```

#### Save Setting
- **Endpoint:** `POST /api/settings`
- **Request Body:**
  ```json
  {
    "key": "TELEGRAM_BOT_TOKEN",
    "value": "123456789:ABCdefGhI"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Setting saved"
  }
  ```

#### Save Settings In Bulk
- **Endpoint:** `POST /api/settings/save`
- **Request Body:**
  ```json
  {
    "EMAIL_PARSER_ENABLED": "true",
    "WHATSAPP_REMINDERS_ENABLED": "false"
  }
  ```
- **Description:** Overwrites multiple keys into the `app_settings` table.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Settings saved"
  }
  ```

---

### Dispatch & Delivery Boys (`/api/dispatch`)

#### Create Dispatch Action
- **Endpoint:** `POST /api/dispatch`
- **Request Body:**
  ```json
  {
    "type": "TICKET",
    "description": "Urgent medicine dispatch to Ward 4",
    "contact": "+918888888888"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Dispatch logged"
  }
  ```

#### Get Delivery Boys Directory
- **Endpoint:** `GET /api/dispatch/delivery-boys`
- **Response (200 OK):**
  ```json
  [
    {
      "id": 1,
      "name": "Rohan Sharma",
      "whatsapp_number": "+919876543211",
      "telegram_chat_id": 89283928,
      "is_active": 1
    }
  ]
  ```

#### Add Delivery Boy
- **Endpoint:** `POST /api/dispatch/delivery-boys`
- **Request Body:**
  ```json
  {
    "name": "Rohan Sharma",
    "whatsapp_number": "+919876543211",
    "telegram_chat_id": 89283928,
    "is_active": 1
  }
  ```
- **Response (201 Created):** Returns the newly created database record object.

#### Edit Delivery Boy Details
- **Endpoint:** `PUT /api/dispatch/delivery-boys/:id`
- **Request Body:** Partial object containing fields to update.
- **Response (200 OK):** Returns the updated delivery boy object.

#### Delete Delivery Boy
- **Endpoint:** `DELETE /api/dispatch/delivery-boys/:id`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Delivery boy deleted"
  }
  ```

---

### Telegram Prescription Cart (`/api/telegram-prescription`)

#### Get Active Cart for Telegram Chat
- **Endpoint:** `GET /api/telegram-prescription/cart/:chatId`
- **Response (200 OK):**
  ```json
  {
    "chatId": 58293928,
    "items": [
      {
        "medicine_name": "Paracetamol 500mg",
        "quantity": 2,
        "unit_price": 15.5,
        "inventory_id": 4
      }
    ],
    "subtotal": 31.0,
    "tax": 1.55,
    "total": 32.55,
    "itemCount": 2
  }
  ```

#### Add Item to Telegram Cart
- **Endpoint:** `POST /api/telegram-prescription/cart/add`
- **Request Body:**
  ```json
  {
    "chatId": 58293928,
    "medicineName": "Paracetamol 500mg",
    "quantity": 1
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Item added to cart",
    "cart": {
      "subtotal": 46.5,
      "tax": 2.325,
      "total": 48.825,
      "itemCount": 3
    }
  }
  ```

#### Clear Telegram Cart
- **Endpoint:** `DELETE /api/telegram-prescription/cart/:chatId`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Cart cleared"
  }
  ```

#### Generate Bill from Telegram Cart
- **Endpoint:** `POST /api/telegram-prescription/bill/generate`
- **Request Body:**
  ```json
  {
    "chatId": 58293928,
    "patient_id": 3,
    "doctor_id": null,
    "discount": 5.0
  }
  ```
- **Description:** Finalizes the items inside the Telegram chat's temporary cart, creates a sale invoice record, decrements the inventory level, and clears the cart on success.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "invoice_no": "S-2026-0008",
    "total": 43.825,
    "tax": 2.325,
    "message": "Bill generated successfully"
  }
  ```

---

## AI Camera Auditing (`/api/aicamera`)

#### Get Pending Human Review Audits Queue
- **Endpoint:** `GET /api/aicamera/audit/queue`
- **Description:** Returns all OCR processed items flagged with `pending_human_review` status from the audit queue JSON file.
- **Response (200 OK):**
  ```json
  [
    {
      "id": "1716654890123-abc",
      "image_path": "catalog/1716654890123-filename.jpg",
      "status": "pending_human_review",
      "ocr_text": "...",
      "extracted_data": {
        "name": "UnknownMedicine 250mg",
        "batchNumber": "UNK882",
        "mrp": 180
      }
    }
  ]
  ```

#### Resolve Human Audit Queue Entry
- **Endpoint:** `POST /api/aicamera/audit/resolve`
- **Request Body:**
  ```json
  {
    "id": "1716654890123-abc",
    "name": "KnownMedicine 250mg",
    "strength": "250mg",
    "batchNumber": "KNO882",
    "expiryDate": "2028-10-01",
    "mrp": 180,
    "action": "add_to_db"
  }
  ```
- **Description:** Allows manual correction of parsed data. If `action` is `add_to_db`, the medicine and batch/inventory record are inserted into the database. Marks queue entry status as `resolved` or `dismissed`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Queue entry 1716654890123-abc successfully resolved"
  }
  ```

#### Delete Audit Queue Entry
- **Endpoint:** `DELETE /api/aicamera/audit/:id`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Queue entry 1716654890123-abc deleted"
  }
  ```
