import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig(() => {
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      strictPort: false,
      open: true,
      proxy: {
        // RAG + AI routes → FastAPI on 8001
        '/api/ingest-rag': { target: 'http://localhost:8001', changeOrigin: true },
        '/api/chat':        { target: 'http://localhost:8001', changeOrigin: true },
        '/api/rag-status':  { target: 'http://localhost:8001', changeOrigin: true },
        // File tree, file content, GitHub, rate-limit → Express on 3001
        '/api':             { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
  }
})
