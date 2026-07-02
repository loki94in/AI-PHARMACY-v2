# PHARMACY WHATSAPP AUTOMATION AGENT SPEC

**Created**: 2026-06-13
**Status**: Design Spec (Not Yet Implemented)

---

## Purpose

This agent manages all WhatsApp-based communication for a pharmacy workflow covering:
- Customer orders
- Prescription handling
- Stock management
- Distributor coordination
- Internal staff coordination (delivery boy / pharmacy team)

## Core Principle

Every event in the pharmacy system triggers a contextual WhatsApp message to the correct recipient (Customer / Delivery Boy / Distributor / Staff). The system must ensure timely, minimal, and accurate communication without duplication.

---

## 1. CUSTOMER AUTOMATIONS

### (1) Medicine Back in Stock
- **Trigger**: Out-of-stock medicine becomes available in inventory
- **Recipient**: Customer
- **Message**: "Your requested medicine is now available at XYZ Pharmacy. Please collect it or place an order."

### (2) Ready for Pickup
- **Trigger**: Order marked as ready in pharmacy system
- **Recipient**: Customer
- **Message**: "Your medicines are ready for collection from XYZ Pharmacy."

### (3) Monthly Refill Reminder
- **Trigger**: Configurable interval (1–30 days after last purchase)
- **Recipient**: Customer
- **Message**: "It's time to refill your medicine. Reply YES to reorder."

### (4) Low Medicine Adherence Alert
- **Trigger**: Customer has not refilled medicine after expected cycle
- **Recipient**: Customer
- **Message**: "Our records show you may be running low on your medication."

### (5) Delivery Completed
- **Trigger**: Order marked delivered/completed
- **Recipient**: Customer
- **Message**: "Your medicines have been delivered. Thank you."

### (6) Prescription Expiry Reminder
- **Trigger**: Prescription nearing expiry
- **Recipient**: Customer
- **Message**: "Your prescription will expire soon. Please upload a new prescription to continue ordering."

### (7) Pickup Reminder
- **Trigger**: Order ready but not collected after 24–48 hours
- **Recipient**: Customer
- **Message**: "Your medicines are still waiting for pickup at XYZ Pharmacy. Please collect them at your convenience."

### (8) Special Request Medicine Arrived
- **Trigger**: Requested medicine added to inventory after distributor supply
- **Recipient**: Customer
- **Message**: "Your requested medicine has arrived at XYZ Pharmacy and is ready for collection."

---

## 2. INTERNAL PHARMACY AUTOMATIONS

### (9) Special Request → Delivery Boy
- **Trigger**: Customer requests unavailable medicine
- **Recipient**: Delivery Boy
- **Message**:
  ```
  Special Request:
  Distributor: [Distributor Name]
  Medicine: [Medicine Name + Qty]
  Please collect during today's distributor visit.
  ```

### (10) Distributor-wise Daily Pickup List
- **Trigger**: Daily scheduled aggregation before distributor rounds
- **Recipient**: Delivery Boy
- **Message**:
  ```
  Today's Collection List:
  Distributor: [Name]
  Items:
  - Medicine A
  - Medicine B
  - Medicine C
  Please collect all items today.
  ```

### (11) Low Stock Alert
- **Trigger**: Stock falls below minimum threshold
- **Recipient**: Pharmacy Staff
- **Message**:
  ```
  Low Stock Alert:
  Medicine: [Name]
  Current Stock: [Qty]
  Reorder recommended.
  ```

### (12) Distributor Order Notification (PharmaRack Order)
- **Trigger**: Purchase order placed through system
- **Recipients**: Distributor, Delivery Boy, Pharmacy Owner (optional)
- **Messages**:
  - **To Distributor**: "New Order Placed from XYZ Pharmacy via PharmaRack. Please process for dispatch."
  - **To Delivery Boy**: "Pickup Required: Distributor: [Name]. Order ready for collection."
  - **To Owner**: "Purchase order successfully sent to distributor."

---

## SYSTEM RULES

- Each event must trigger only one correct workflow (avoid duplicate notifications)
- Messages must be short, clear, and action-oriented
- Always replace placeholders dynamically (customer, medicine, distributor, qty)
- Prioritize medicine continuity and patient safety alerts
- Internal and external communications must be separated
- All workflows must support scheduling and delay triggers (refill, pickup reminders)

---

## Delivery Boy Number Configuration

Delivery boy WhatsApp numbers are managed via:
- **Database**: `delivery_boys` table (`whatsapp_number` column)
- **API**: `GET/POST/PUT/DELETE /api/dispatch/delivery-boys`
- **UI**: Settings page → Messaging Integrations → Delivery Boy / Staff Numbers section
