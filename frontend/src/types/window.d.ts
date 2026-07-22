// Properly types all custom globals attached to `window` in this project.
// Eliminates (window as any) unsafe casts without changing any runtime behavior.

declare global {
  interface Window {
    /** Compact inventory cache populated by Layout on load (read by api.ts getCompactInventoryCache). */
    __INVENTORY__?: unknown[];

    /** Opens the BackupCenterModal from anywhere in the app. Registered by Layout, cleaned up on unmount. */
    openBackupCenter?: () => void;

    /** Re-fetches the staged sale/purchase counts badge in the nav. Registered by Layout, cleaned up on unmount. */
    refreshStagedCounts?: () => void;
  }
}

export {};
