import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The site is served from https://giorgioassenza-collab.github.io/otacos-gantt/
export default defineConfig({
  base: "/otacos-gantt/",
  plugins: [
    react(),
    ...(process.env.NO_PWA ? [] : [VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["otacos-logo.svg", "fonts/*.woff2"],
      manifest: {
        name: "O'Tacos Workflow",
        short_name: "Workflow",
        description: "O'Tacos marketing workflow: Gantt, editorial plan, influencers, creator calendar and budget.",
        lang: "en",
        start_url: "/otacos-gantt/",
        scope: "/otacos-gantt/",
        display: "standalone",
        background_color: "#17120f",
        theme_color: "#17120f",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/otacos-gantt/index.html",
        // the previous version of the site lives in /legacy-v1/ and must not be taken over by this app
        navigateFallbackDenylist: [/^\/otacos-gantt\/legacy-v1\//],
        // Firestore, Google Sheets and the approvals API are always live data: never cache them.
        runtimeCaching: []
      }
    })])
  ],
  test: { environment: "node" }
});
