import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'fs'
import { resolve } from 'path'

// `vercel dev` assigns the dev server a port via PORT and expects Vite to bind
// to exactly that one. Affects local dev only — `vite build` ignores `server`.
const assignedPort = Number(process.env.PORT)

// Serves the Vercel functions in /api under plain `vite` so the CRM works
// locally without the Vercel CLI. Mimics the Vercel Node runtime: parsed JSON
// req.body plus res.status()/res.json(). Dev only — skipped under `vercel dev`,
// which runs the functions itself.
function vercelApiDev(mode) {
  return {
    name: 'vercel-api-dev',
    apply: 'serve',
    configureServer(server) {
      if (assignedPort) return
      // Load every var (not just VITE_*) so handlers see SUPABASE_URL etc.
      const env = loadEnv(mode, process.cwd(), '')
      for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

      server.middlewares.use(async (req, res, next) => {
        const match = req.url.match(/^\/api\/([\w-]+)(?:\?|$)/)
        if (!match) return next()
        const file = resolve('api', `${match[1]}.js`)
        if (!existsSync(file)) return next()

        res.status = code => { res.statusCode = code; return res }
        res.json = data => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
          return res
        }

        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString()
          const isJson = (req.headers['content-type'] || '').includes('application/json')
          req.body = raw && isJson ? JSON.parse(raw) : raw || undefined
          req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)

          const { default: handler } = await server.ssrLoadModule(file)
          await handler(req, res)
        } catch (e) {
          console.error(`[api/${match[1]}]`, e)
          if (!res.headersSent) res.status(500).json({ success: false, error: e.message })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), vercelApiDev(mode)],
  server: {
    port: assignedPort || 5173,
    strictPort: Boolean(assignedPort),
  },
}))
