import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const isProduction = process.env.NODE_ENV === "production"

// 优先使用环境变量，其次默认4096
const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || "4096"

const proxyTarget = `http://localhost:${serverPort}`

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: isProduction
      ? undefined
      : {
          "/global": {
            target: proxyTarget,
            changeOrigin: true,
            onProxyReq: (proxyReq) => {
              const auth = Buffer.from("myopencode:123").toString("base64")
              proxyReq.setHeader("Authorization", `Basic ${auth}`)
            },
          },
        },
  },
  build: {
    target: "esnext",
  },
})
