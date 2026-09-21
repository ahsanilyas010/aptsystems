import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vercel dev` assigns the dev server a port via PORT and expects Vite to bind
// to exactly that one. Affects local dev only — `vite build` ignores `server`.
const assignedPort = Number(process.env.PORT)

export default defineConfig({
  plugins: [react()],
  server: {
    port: assignedPort || 5173,
    strictPort: Boolean(assignedPort),
  },
})
