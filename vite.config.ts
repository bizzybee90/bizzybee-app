import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8080,
  },
  plugins: [react(), mode === 'development' && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'ui-vendor': ['recharts', 'lucide-react'],
          'supabase-vendor': ['@supabase/supabase-js'],
        },
      },
    },
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://ikioetqbrybnofqkdcib.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlraW9ldHFicnlibm9mcWtkY2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0MTY0NjksImV4cCI6MjA3ODk5MjQ2OX0.QdmwwkzNYj9jzeD5oRGMAJm-4ADcJc5EEpqVKwhOyOw',
    ),
  },
}));
