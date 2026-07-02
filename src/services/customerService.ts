import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { config } from '../config/index.js';

export interface CustomerData {
  id?: number;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  doctorName?: string;
  doctorContact?: string;
}

export interface CustomerResult extends CustomerData {
  createdAt?: string;
  updatedAt?: string;
}

export class CustomerService {
  /**
   * Find customer by ID
   */
  async findById(id: number): Promise<CustomerResult | null> {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    await dbManager.close();
    return row ? (row as CustomerResult) : null;
  }

  /**
   * Find customer by phone number
   */
  async findByPhone(phone: string): Promise<CustomerResult | null> {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT * FROM customers WHERE phone = ?', [phone]);
    await dbManager.close();
    return row ? (row as CustomerResult) : null;
  }

  /**
   * Find customer by name and phone
   */
  async findByNameAndPhone(name: string, phone: string): Promise<CustomerResult | null> {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT * FROM customers WHERE name = ? AND phone = ?', [name, phone]);
    await dbManager.close();
    return row ? (row as CustomerResult) : null;
  }

  /**
   * Create a new customer
   */
  async createCustomer(data: CustomerData): Promise<CustomerResult> {
    return await dbManager.transaction(async (db) => {
      const result = await db.run(
        'INSERT INTO customers (name, phone, address, email, doctor_name, doctor_contact) VALUES (?, ?, ?, ?, ?, ?)',
        [
          data.name,
          data.phone ?? null,
          data.address ?? null,
          data.email ?? null,
          data.doctorName ?? null,
          data.doctorContact ?? null
        ]
      );

      const created = await this.findById(result.lastID ?? 0);
      if (!created) {
        throw new Error('Failed to retrieve customer after creation');
      }
      return created;
    });
  }

  /**
   * Update customer by ID
   */
  async updateCustomer(id: number, data: Partial<CustomerData>): Promise<CustomerResult | null> {
    return await dbManager.transaction(async (db) => {
      // Build dynamic update query
      const fields = [];
      const values: any[] = [];

      if (data.name !== undefined) {
        fields.push('name = ?');
        values.push(data.name);
      }
      if (data.phone !== undefined) {
        fields.push('phone = ?');
        values.push(data.phone);
      }
      if (data.address !== undefined) {
        fields.push('address = ?');
        values.push(data.address);
      }
      if (data.email !== undefined) {
        fields.push('email = ?');
        values.push(data.email);
      }
      if (data.doctorName !== undefined) {
        fields.push('doctor_name = ?');
        values.push(data.doctorName);
      }
      if (data.doctorContact !== undefined) {
        fields.push('doctor_contact = ?');
        values.push(data.doctorContact);
      }

      if (fields.length === 0) {
        // No fields to update
        return await this.findById(id);
      }

      values.push(id);
      const query = `UPDATE customers SET ${fields.join(', ')} WHERE id = ?`;

      await db.run(query, values);
      await dbManager.close();

      return await this.findById(id);
    });
  }

  /**
   * Delete customer by ID
   */
  async deleteCustomer(id: number): Promise<boolean> {
    return await dbManager.transaction(async (db) => {
      const result = await db.run('DELETE FROM customers WHERE id = ?', [id]);
      await dbManager.close();
      return (result.changes ?? 0) > 0;
    });
  }

  /**
   * Search customers by name or phone
   */
  async searchCustomers(query: string, limit = 10): Promise<CustomerResult[]> {
    const db = await dbManager.getConnection();
    const searchTerm = `%${query}%`;
    const rows = await db.all(
      'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT ?',
      [searchTerm, searchTerm, limit]
    );
    await dbManager.close();
    return rows as CustomerResult[];
  }

  /**
   * Get customer count
   */
  async getCustomerCount(): Promise<number> {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT COUNT(*) as count FROM customers');
    await dbManager.close();
    return row?.count ?? 0;
  }

  /**
   * Get or create customer by phone (useful for sales)
   */
  async getOrCreateCustomerByPhone(phone: string, name?: string): Promise<CustomerResult> {
    return await dbManager.transaction(async (db) => {
      // Try to find existing customer
      let customer = await this.findByPhone(phone);

      if (!customer && name) {
        // Create new customer if not found and name provided
        customer = await this.createCustomer({
          name,
          phone,
          address: '',
          email: '',
          doctorName: '',
          doctorContact: ''
        });
      }

      if (!customer) {
        throw new Error('Customer not found and insufficient data to create');
      }

      return customer;
    });
  }
}

// Singleton instance
export const customerService = new CustomerService();