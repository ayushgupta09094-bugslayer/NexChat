// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    sourcemap:     false,
    minify:        'terser',
    rollupOptions: {
      input: './index.html',
      output: {
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash].[ext]'
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});