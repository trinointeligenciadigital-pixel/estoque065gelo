import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Estoque 065 — PWA mobile-first, instalável.
// Ícones e refinamento final do PWA são a Fase 5; aqui fica a base funcional.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Estoque 065",
        short_name: "Estoque 065",
        description: "Controle de estoque da 065 Gelo",
        lang: "pt-BR",
        theme_color: "#0E7C9C",
        background_color: "#EEF3F4",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: {
        // Permite testar a instalação do PWA já em desenvolvimento.
        enabled: true,
      },
    }),
  ],
});
