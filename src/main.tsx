import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/tokens.css';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { initNative } from './lib/native';
import { initSentry } from './lib/sentry';

// Initialize error tracking and native capabilities
initSentry();
initNative();

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
