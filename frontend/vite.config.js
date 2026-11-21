import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_BASE_URL')
  const api = new URL(env.API_BASE_URL ?? 'http://localhost:3001')
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash || api.pathname !== '/') {
    throw new Error('API_BASE_URL debe ser el origen HTTP(S) de la API, sin ruta ni credenciales.')
  }

  return {
    define: { 'import.meta.env.API_BASE_URL': JSON.stringify(api.origin) },
    server: { host: 'localhost', port: 5173, strictPort: true }
  }
})
