import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Windows sometimes resolves 'localhost' to the IPv6 loopback only,
    // binding Vite to [::1] while browser requests race to 127.0.0.1 and
    // hang instead of failing fast — pin to IPv4 loopback to avoid that.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      }
    }
  },
  optimizeDeps: {
    include: ['lucide-react']
  },
  build: {
    rollupOptions: {
      output: {
        // Split vendor libs into stable cached chunks separate from page code.
        // Matched on node_modules/<pkg>/ segments (not bare substring) so packages like
        // @tanstack/react-query and @tanstack/react-virtual don't get swept into the
        // 'react' bucket just because their path happens to contain "react".
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          const normalized = id.replace(/\\/g, '/');

          // Core React runtime + router — needed on every page, loads eagerly.
          if (/\/node_modules\/(react|react-dom|react-router-dom|scheduler)\//.test(normalized)) {
            return 'vendor-react';
          }
          // TanStack Query — used app-wide (global queryClient), but changes/version-bumps
          // independently of React itself, so keep it out of vendor-react for cache stability.
          if (/\/node_modules\/@tanstack\/(react-query|query-core)\//.test(normalized)) {
            return 'vendor-query';
          }
          // TanStack Virtual — only used by list-virtualized pages (Sells, Inventory,
          // PurchaseHistory, Investigation, CustomerReturnHistory). Previously this matched
          // the broad 'react' check above and got bundled into vendor-react, forcing every
          // page to download it eagerly on boot even when nothing on the page virtualizes.
          if (/\/node_modules\/@tanstack\/(react-virtual|virtual-core)\//.test(normalized)) {
            return 'vendor-virtual';
          }
          if (normalized.includes('/node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
          if (/\/node_modules\/(axios|clsx|tailwind-merge)\//.test(normalized)) {
            return 'vendor-utils';
          }
          // Agentation feedback/devtools widget is mounted unconditionally at the app root
          // (see App.tsx) and is large, but it's app-independent third-party code — split it
          // out of the main entry chunk so it can be parsed/downloaded in parallel and cached
          // independently of app code that changes on every build.
          if (normalized.includes('/node_modules/agentation/')) {
            return 'vendor-agentation';
          }
          // Everything else (motion, jspdf, jspdf-autotable, html2canvas, dompurify, canvg, ...)
          // is left to Rollup's automatic chunking, which already isolates them behind their
          // existing dynamic-import boundaries (e.g. jsPDF only loads when a page dynamically
          // imports the PDF export util) — naming them here would just force them together.
        },
      },
    },
  },
})
