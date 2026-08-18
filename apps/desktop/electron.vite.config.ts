import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

const protocolAlias = resolve(__dirname, '../../packages/protocol/src/index.ts')
const sessionStoreAlias = resolve(__dirname, '../../packages/session-store/src/index.ts')
const permissionsAlias = resolve(__dirname, '../../packages/permissions/src/index.ts')

export default defineConfig({
  main: {
    build: {
      // @dshd/* 是 workspace 源码包(exports 指向 .ts),必须由 alias 内联打包,
      // 不能被 electron-vite 默认的 externalizeDeps 当成外部依赖留下 require()。
      // 否则运行时 Node 直接加载 .ts 源会 ERR_MODULE_NOT_FOUND。
      externalizeDeps: { exclude: ['@dshd/protocol', '@dshd/session-store', '@dshd/permissions'] },
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
