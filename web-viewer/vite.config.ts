import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  },
  plugins: [
    {
      name: 'copy-favicon',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'favicon.svg',
          source: readFileSync(resolve(__dirname, 'favicon.svg'), 'utf-8')
        });
      }
    }
  ]
});
