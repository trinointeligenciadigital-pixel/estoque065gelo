import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Pré-carrega as fontes que a primeira tela sempre usa (texto, título, número,
// rótulo). Sem isso, o navegador só descobre a fonte depois de ler o CSS e a
// tela abre com a fonte reserva e "pula" quando a certa chega (font-display:
// swap). Só o subconjunto latin (cobre o português inteiro); só no build — no
// dev os nomes não têm hash e o bundle não existe.
function precarregarFontes(): Plugin {
  const criticas = /^assets\/(inter-latin-400|poppins-latin-600|space-grotesk-latin-600|ibm-plex-mono-latin-500)-normal-[\w-]+\.woff2$/;
  return {
    name: "precarregar-fontes",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((nome) => criticas.test(nome))
          .map((nome) => ({
            tag: "link",
            attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: "", href: "/" + nome },
            injectTo: "head" as const,
          }));
      },
    },
  };
}

// Estoque 065 — PWA mobile-first, instalável.
// Ícones e refinamento final do PWA são a Fase 5; aqui fica a base funcional.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    precarregarFontes(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      workbox: {
        // Fontes do subconjunto latin entram no cache do app instalado: com o
        // sinal oscilando na porta da câmara, o texto não volta a cair na fonte
        // reserva. Sem latin-ext/devanagari/woff antigo (peso inútil aqui).
        globPatterns: ["**/*.{js,css,html,webmanifest}", "assets/*-latin-*-normal-*.woff2"],
        globIgnores: ["**/*-latin-ext-*"],
      },
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
