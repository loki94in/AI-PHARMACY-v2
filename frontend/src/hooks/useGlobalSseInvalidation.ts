import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ensureCompactInventoryReady } from '../services/api';

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
  sale_created: [['dashboard'], ['reports'], ['sales'], ['invoices'], ['sells-list'], ['investigation-list']],
  invoice_saved: [['purchases'], ['purchase-history'], ['purchase-history-list'], ['inventory'], ['inventory-list'], ['dashboard'], ['reports'], ['investigation-list'], ['schedule-drugs-list']],
  return_created: [['returns'], ['returns-history'], ['customer-returns'], ['pending-returns'], ['inventory'], ['inventory-list'], ['dashboard'], ['reports']],
  inventory_changed: [['inventory'], ['inventory-list'], ['compact-inventory'], ['pos-inventory'], ['expiry'], ['schedule-drugs-list']],
  expiry_list_changed: [['expiry'], ['expiry-reviews']],
  order_updated: [['orders'], ['pos-special-orders']],
  refill_updated: [['refills'], ['crm-refills']],
  email_new: [['mail-inbox'], ['mail']],
  dispatch_updated: [['dispatch-orders'], ['delivery-boys'], ['distributor-reminders']],
  catalog_job_done: [['catalog-jobs'], ['medicines'], ['schedule-drugs-summary']],
  sales_sync: [['sells-list'], ['investigation-list']],
  purchases_sync: [['purchase-history-list'], ['investigation-list']],
  pharmarack_cart_changed: [['pharmarack-cart']],
};

// SSE event type -> DOM CustomEvents dispatched for non-react-query consumers
const SSE_CUSTOM_EVENTS: Record<string, string[]> = {
  activity_logged: ['sse-activity-logged'],
  order_updated: ['refresh-special-orders'],
  refill_updated: ['app-refills-updated'],
  return_created: ['sse-return-created'],
  wa_status_changed: ['sse-wa-status-changed'],
  wa_queue_update: ['sse-wa-status-changed', 'sse-wa-queue-updated'],
  wa_new_message: ['sse-wa-new-message'],
  wa_medicine_match: ['sse-wa-medicine-match'],
  ocr_scan_complete: ['sse-ocr-scan-complete'],
  auth_failure: ['sse-auth-failure'],
  pharmarack_session_refreshed: ['sse-pharmarack-refreshed'],
  // Reuses the page's existing DOM event name — PharmarackCart, LiveCartAddModal
  // and Layout already listen for 'refresh-pharmarack-cart'.
  pharmarack_cart_changed: ['refresh-pharmarack-cart'],
  dispatch_updated: ['sse-dispatch-updated'],
  email_new: ['sse-email-new'],
  inventory_changed: ['sse-inventory-changed'],
  invoice_saved: ['sse-invoice-saved'],
  sale_created: ['sse-sale-created'],
  catalog_job_progress: ['sse-catalog-job'],
  catalog_job_update: ['sse-catalog-job'],
  catalog_review_updated: ['sse-catalog-review'],
  migration_update: ['sse-migration-update'],
  google_verification_required: ['sse-google-verification'],
  google_verification_solved: ['sse-google-verification'],
  toast_alert: ['app-show-toast'],
  automation_hub_updated: ['app-automation-hub-updated'],
  message_send_progress: ['app-message-send-progress'],
};

// Chrome-owned queries rendered OUTSIDE KeepAliveOutlet pages (Layout /
// Topbar / QuickAssistSidebar) have no PageQueryTracker to refresh them on
// page activation, so these keep the classic immediate-refetch behavior.
const CHROME_INSTANT_KEYS: string[][] = [
  ['orders'],
  ['refills'],
  ['settings'],
];

// Minimal shape of a parsed SSE frame; payload fields stay free-form so
// CustomEvent consumers can read domain-specific properties off `detail`.
interface SseFrame {
  type?: string;
  [field: string]: unknown;
}

export function useGlobalSseInvalidation(enabled: boolean = true) {
  const queryClient = useQueryClient();
  // ponytail: throttle identical bursts (e.g. bulk imports emitting many events)
  const lastInvalidated = useRef<Record<string, number>>({});
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let isDestroyed = false;

    const connect = () => {
      if (isDestroyed) return;
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
      }

      const es = new EventSource('/api/notifications/stream');
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        let type: string;
        let parsed: SseFrame;
        try {
          parsed = JSON.parse(e.data);
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
          queryKeys.forEach(key => {
            // Deferred-SSE contract: hidden kept-alive pages only get MARKED
            // STALE here (refetchType: 'none') — their PageQueryTracker silently
            // refreshes them on next activation, so one backend write can never
            // fan out into simultaneous refetches across every visited page.
            void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
          });
          CHROME_INSTANT_KEYS.forEach(key => {
            void queryClient.refetchQueries({ queryKey: key, stale: true });
          });
        }

        // Keep local compact inventory cache updated on stock mutations
        if (type === 'inventory_changed' || type === 'invoice_saved' || type === 'sale_created') {
          void ensureCompactInventoryReady();
        }

        (SSE_CUSTOM_EVENTS[type] || []).forEach(evtName => {
          // detail carries the full parsed SSE frame (or unpacked payload for toasts) so page-level listeners
          // can consume payloads without opening their own EventSource
          const detailData = (evtName === 'app-show-toast' && parsed?.payload) ? parsed.payload : parsed;
          window.dispatchEvent(new CustomEvent(evtName, { detail: detailData }));
        });
      };

      es.onerror = () => {
        // If the connection drops or is closed, reconnect on error if not destroyed
        if (es.readyState === EventSource.CLOSED && !isDestroyed) {
          es.close();
          setTimeout(() => {
            if (!isDestroyed) connect();
          }, 3000);
        }
      };
    };

    connect();

    // Idle-wake reconnect handler: when user returns to tab after idle or sleep,
    // ensure SSE connection is alive and healthy.
    const handleWakeUp = () => {
      if (document.visibilityState === 'visible' && !isDestroyed) {
        if (!esRef.current || esRef.current.readyState === EventSource.CLOSED) {
          connect();
        }
      }
    };

    window.addEventListener('focus', handleWakeUp);
    document.addEventListener('visibilitychange', handleWakeUp);
    window.addEventListener('online', handleWakeUp);

    return () => {
      isDestroyed = true;
      window.removeEventListener('focus', handleWakeUp);
      document.removeEventListener('visibilitychange', handleWakeUp);
      window.removeEventListener('online', handleWakeUp);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [enabled, queryClient]);
}
