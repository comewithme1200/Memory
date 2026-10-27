import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' => hoạt động được cả với github.io/<ten-repo> lẫn trang gốc
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: true,
  },
})
