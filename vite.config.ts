import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@nexus-agent/desktop-shared': path.resolve(__dirname, './shared/src')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4174
  },
  test: {
    environment: 'jsdom',
    // Scope collection to the renderer source. build/ and release/ ship
    // node-pty's own .test.js (they try to load native .node modules and
    // fail under jsdom), and electron/ + scripts/ hold node:test .cjs files
    // run via `npm run test:desktop:platforms` — none of those are vitest
    // tests, but the default glob collected all of them as failed files.
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  }
})
