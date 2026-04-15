import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';
import { componentTagger } from 'lovable-tagger';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const;
  const missing = required.filter((key) => !env[key]);
  const sentryRelease = env.SENTRY_RELEASE || env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA;
  const sentryBuildEnabled =
    mode === 'production' &&
    Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT && sentryRelease);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    server: {
      host: '::',
      port: 8080,
    },
    plugins: [
      react(),
      mode === 'development' && componentTagger(),
      sentryBuildEnabled &&
        sentryVitePlugin({
          org: env.SENTRY_ORG,
          project: env.SENTRY_PROJECT.split(',')
            .map((project) => project.trim())
            .filter(Boolean),
          authToken: env.SENTRY_AUTH_TOKEN,
          url: env.SENTRY_URL,
          telemetry: false,
          release: {
            name: sentryRelease,
            create: true,
            finalize: true,
            setCommits: {
              auto: true,
            },
            deploy: {
              env: mode,
            },
          },
          sourcemaps: {
            filesToDeleteAfterUpload: ['dist/**/*.map'],
          },
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: sentryBuildEnabled,
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return;
            }

            if (id.includes('jspdf') || id.includes('html2canvas')) {
              return 'pdf-vendor';
            }

            if (id.includes('@supabase/supabase-js')) {
              return 'supabase-vendor';
            }

            if (id.includes('@tanstack/react-query')) {
              return 'query-vendor';
            }
          },
        },
      },
    },
  };
});
