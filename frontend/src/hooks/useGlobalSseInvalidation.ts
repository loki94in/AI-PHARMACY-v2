import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * P1 "events, not timers" (API_OPTIMIZATION_IMPLEMENTATION_PLAN.md §3/§7).
 *
 * ONE global SSE listener for the whole SPA. Backend write points broadcast
 * domain events via eventService; this hook maps them to react-query cache
 * invalidations + DOM CustomEvents. Replaces all periodic polling.
 *
 * New feature checklist (§7): emit a backend event at your write point,
 * then add one line to SSE_QUERY_MAP / SSE_CUSTOM_EVENTS below.
 */

// SSE event type -> react-query cache keys to invalidate
const SSE_QUERY_MAP: Record<string, string[][]> = {
  sale_created: [['dashboard'], ['reports'], ['sales'], ['invoices']],
  invoice_saved: [['purchases'], ['purchase-history'], ['inventory'], ['dashboard'], ['reports']],
  return_created: [['returns'], ['returns-history'], ['customer-returns'], ['pending-returns'], ['inventory'], ['dashboard'], ['reports']],
  inventory_changed: [['inventory'], ['compact-inventory'], ['pos-inventory'], ['expiry']],
  expiry_list_changed: [['expiry'], ['expiry-reviews']],
  order_updated: [['orders'], ['pos-special-orders']],
  refill_updated: [['refills'], ['crm-refills']],
  email_new: [['mail-inbox'], ['mail']],
  dispatch_updated: [['dispatch-orders'], ['delivery-boys'], ['distributor-reminders']],
  catalog_job_done: [['catalog-jobs'], ['medicines']],
};

// SSE event type -> DOM CustomEvents dispatched for non-react-query consumers
const SSE_CUSTOM_EVENTS: Record<string, string[]> = {
  activity_logged: ['sse-activity-logged'],
  order_updated: ['refresh-special-orders'],
  refill_updated: ['app-refills-updated'],
  return_created: ['sse-return-created'],
  wa_status_changed: ['sse-wa-status-changed'],
  wa_queue_update: ['sse-wa-status-changed', 'sse-wa-queue-updated'],
  pharmarack_session_refreshed: ['sse-pharmarack-refreshed'],
  dispatch_updated: ['sse-dispatch-updated'],
  email_new: ['sse-email-new'],
  inventory_changed: ['sse-inventory-changed'],
  invoice_saved: ['sse-invoice-saved'],
  sale_created: ['sse-sale-created'],
};

export function useGlobalSseInvalidation(enabled: boolean = true) {
  const queryClient = useQueryClient();
  // ponytail: throttle identical bursts (e.g. bulk imports emitting many events)
  const lastInvalidated = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/notifications/stream');

    const handleMessage = (e: MessageEvent) => {
      let type: string;
      try {
        const parsed = JSON.parse(e.data);
        type = parsed?.type || '';
      } catch {
        return;
      }
      if (!type || type === 'connected') return;

      const now = Date.now();
      const queryKeys = SSE_QUERY_MAP[type];
      if (queryKeys) {
        const last = lastInvalidated.current[type] || 0;
        if (now - last < 1500) return; // dedupe bursts
        lastInvalidated.current[type] = now;
        queryKeys.forEach(key => queryClient.invalidateQueries({ queryKey: key }));
      }
      (SSE_CUSTOM_EVENTS[type] || []).forEach(evtName => {
        window.dispatchEvent(new CustomEvent(evtName));
      });
    };

    es.onmessage = handleMessage;
    // Auto-reconnect handled by browser EventSource; nothing else needed.

    return () => {
      es.close();
    };
  }, [enabled, queryClient]);
}
