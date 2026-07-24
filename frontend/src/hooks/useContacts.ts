import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

export interface UnifiedContact {
  id: number;
  name: string;
  type: 'distributor' | 'delivery_boy' | 'doctor' | 'customer' | 'owner' | 'admin';
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  alias_names?: string | null;
  is_active: number;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function useContacts(initialType?: string) {
  const [contacts, setContacts] = useState<UnifiedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContacts = useCallback(async (typeFilter?: string, searchFilter?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getContacts(typeFilter || initialType, searchFilter);
      if (res && res.success) {
        setContacts(res.data || []);
      }
    } catch (err: any) {
      console.error('[useContacts] Failed to fetch contacts:', err);
      setError(err?.response?.data?.error || 'Failed to fetch contacts');
    } finally {
      setLoading(false);
    }
  }, [initialType]);

  useEffect(() => {
    fetchContacts();

    // Subscribe to global event bus for multi-component live updates
    const handleUpdate = () => {
      fetchContacts();
    };

    window.addEventListener('contacts-updated', handleUpdate);
    window.addEventListener('phone-numbers-updated', handleUpdate);
    return () => {
      window.removeEventListener('contacts-updated', handleUpdate);
      window.removeEventListener('phone-numbers-updated', handleUpdate);
    };
  }, [fetchContacts]);

  const saveContact = async (data: {
    name: string;
    type: string;
    phone?: string;
    email?: string;
    address?: string;
    gstin?: string;
    notes?: string;
    alias_names?: string;
    is_active?: number;
  }) => {
    try {
      const res = await api.saveContact(data);
      if (res && res.success) {
        toastEvent.trigger(`Contact "${data.name}" saved!`, 'success');
        // Dispatch global sync events
        window.dispatchEvent(new CustomEvent('contacts-updated'));
        window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
        await fetchContacts();
        return res.data;
      }
    } catch (err: any) {
      console.error('[useContacts] Failed to save contact:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to save contact', 'error');
      throw err;
    }
  };

  const updateContact = async (
    id: number,
    data: Partial<{
      name: string;
      type: string;
      phone: string;
      email: string;
      address: string;
      gstin: string;
      notes: string;
      alias_names: string;
      is_active: number;
    }>
  ) => {
    try {
      const res = await api.updateContact(id, data);
      if (res && res.success) {
        toastEvent.trigger('Contact updated!', 'success');
        window.dispatchEvent(new CustomEvent('contacts-updated'));
        window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
        await fetchContacts();
        return res.data;
      }
    } catch (err: any) {
      console.error('[useContacts] Failed to update contact:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to update contact', 'error');
      throw err;
    }
  };

  const deleteContact = async (id: number) => {
    try {
      const res = await api.deleteContact(id);
      if (res && res.success) {
        toastEvent.trigger('Contact deleted', 'info');
        window.dispatchEvent(new CustomEvent('contacts-updated'));
        window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
        await fetchContacts();
        return true;
      }
    } catch (err: any) {
      console.error('[useContacts] Failed to delete contact:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to delete contact', 'error');
      throw err;
    }
  };

  return {
    contacts,
    loading,
    error,
    fetchContacts,
    saveContact,
    updateContact,
    deleteContact,
  };
}
