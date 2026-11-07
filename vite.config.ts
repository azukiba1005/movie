import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import workerApp from './worker/index';

/**
 * Hybrid Vite Dev Plugin:
 * - If `wrangler dev` is running on 127.0.0.1:8787, forwards `/api/*` to Wrangler (so Workers AI binding is used).
 * - If `npm run dev` is run standalone without `wrangler dev`, executes `worker/index.ts` (Hono) directly in-process!
 */
function cloudflareWorkerFallbackPlugin(): Plugin {
  return {
    name: 'cloudflare-worker-fallback',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          return next();
        }

        // Collect request body chunks
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const bodyBuffer = Buffer.concat(chunks);

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) {
            headers.set(k, v.join(', '));
          } else if (typeof v === 'string') {
            headers.set(k, v);
          }
        }

        const method = req.method || 'GET';
        const hasBody = method !== 'GET' && method !== 'HEAD';

        // 1. Try forwarding to local `wrangler dev` (127.0.0.1:8787) if running
        try {
          const wranglerRes = await fetch(`http://127.0.0.1:8787${req.url}`, {
            method,
            headers,
            body: hasBody ? bodyBuffer : undefined,
          });
          res.statusCode = wranglerRes.status;
          wranglerRes.headers.forEach((val, key) => {
            res.setHeader(key, val);
          });
          const resBuf = Buffer.from(await wranglerRes.arrayBuffer());
          res.end(resBuf);
          return;
        } catch {
          // 2. Fallback: execute Hono worker app directly inside Vite dev server
          try {
            const fullUrl = `http://localhost:5173${req.url}`;
            const webReq = new Request(fullUrl, {
              method,
              headers,
              body: hasBody ? bodyBuffer : undefined,
            });
            const honoRes = await workerApp.fetch(webReq, {
              APP_PASSCODE: process.env.APP_PASSCODE || '',
              GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
            });
            res.statusCode = honoRes.status;
            honoRes.headers.forEach((val, key) => {
              res.setHeader(key, val);
            });
            const outBuf = Buffer.from(await honoRes.arrayBuffer());
            res.end(outBuf);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              })
            );
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflareWorkerFallbackPlugin()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: false,
  },
});
