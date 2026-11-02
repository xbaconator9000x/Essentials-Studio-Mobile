import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bearer token is injected by the Vite *server* proxy only. Never expose
// ESSENTIALS_BROWSER_TOKEN via a VITE_ client environment variable.
const token = process.env.ESSENTIALS_BROWSER_TOKEN;
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    ...(token ? {
      proxy: {
        "/api/browser": {
          target: "http://127.0.0.1:5174",
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/browser/, ""),
          configure: (proxy: { on: (event: string, callback: (req: { setHeader: (name: string, value: string) => void }) => void) => void }) => {
            proxy.on("proxyReq", (request) => {
              request.setHeader("Authorization", "Bearer " + token);
            });
          },
        },
      },
    } : {}),
  },
});
