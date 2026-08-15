import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      lib: {
        // electron-vite derives the entry name from the file name; the
        // electron-vite convention layout (electron/main/index.ts) yields
        // out/main/index.js, matching package.json `main`.
        entry: resolve(__dirname, 'electron/main/index.ts')
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@dshd/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
        '@dshd/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
        '@electron': resolve(__dirname, 'electron')
      }
    }
  }
})
