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
        // Split vendor libs into a stable cached chunk separate from page code
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('axios') || id.includes('clsx') || id.includes('tailwind-merge')) {
              return 'vendor-utils';
            }
          }
        },
      },
    },
  },
})
