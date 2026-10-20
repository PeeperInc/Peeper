import fs from "fs";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sharedHtmlDir = path.resolve(__dirname, "../html");
const legacyPublicDir = path.resolve(__dirname, "public");
const frontierCore = path.resolve(
  __dirname,
  "../backend/frontier/core/index.cjs",
);
const frontierCombat = path.resolve(
  __dirname,
  "../backend/frontier/combat.cjs",
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "frontier-shared-rules",
      enforce: "pre",
      transform(code, id) {
        if (
          ![frontierCore, frontierCombat].some(
            (file) =>
              id.split("?")[0].replaceAll("\\", "/") ===
              file.replaceAll("\\", "/"),
          )
        )
          return;
        // This pure module has one static export and no require() calls. Keep it
        // in Vite's watched source graph, not its cached dependency optimizer.
        if (!code.includes("module.exports ="))
          throw new Error("Frontier core export changed");
        return {
          code: code.replace("module.exports =", "export default"),
          map: null,
        };
      },
    },
  ],
  resolve: {
    alias: {
      "@peeper/frontier-core": frontierCore,
      "@peeper/frontier-combat": frontierCombat,
    },
  },
  optimizeDeps: {
    exclude: ["@peeper/frontier-core", "@peeper/frontier-combat"],
  },
  // In local dev we reuse the same html/ asset layout as production exports.
  // If the shared folder is absent, fall back to the regular frontend/public folder.
  publicDir: fs.existsSync(sharedHtmlDir) ? sharedHtmlDir : legacyPublicDir,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    // Proxy API calls to backend in dev mode
    proxy: {
      "/api": {
        target: process.env.PEEPER_API_TARGET || "http://localhost:4000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    commonjsOptions: { include: [/node_modules/, /frontier[\\/]core/] },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        sausageQuest: path.resolve(__dirname, 'src/sausage-quest/index.html'),
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    // Shared runtime sprites live permanently on the web server and should
    // not be recopied into every production bundle.
    copyPublicDir: !fs.existsSync(sharedHtmlDir),
  },
});
