import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main.ts')
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts')
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
