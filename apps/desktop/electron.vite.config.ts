import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

const protocolAlias = resolve(__dirname, '../../packages/protocol/src/index.ts')
const sessionStoreAlias = resolve(__dirname, '../../packages/session-store/src/index.ts')
const permissionsAlias = resolve(__dirname, '../../packages/permissions/src/index.ts')

export default defineConfig({
  main: {
    build: {
      lib: {
        // electron-vite derives the entry name from the file name; the
        // electron-vite convention layout (electron/main/index.ts) yields
        // out/main/index.js, matching package.json `main`.
        entry: resolve(__dirname, 'electron/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@dshd/protocol': protocolAlias,
        '@dshd/session-store': sessionStoreAlias,
        '@dshd/permissions': permissionsAlias
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      }
    },
    resolve: {
      alias: {
        '@dshd/protocol': protocolAlias
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@dshd/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
        '@dshd/protocol': protocolAlias,
        '@electron': resolve(__dirname, 'electron')
      }
    }
  }
})
