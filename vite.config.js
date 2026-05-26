import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// We have two distribution targets:
//
//   1. Single-file static HTML — for easy hosting / sharing / file://
//      use. Everything inlined into one index.html via
//      vite-plugin-singlefile. This is the default.
//
//   2. Capacitor multi-file build — Capacitor copies whatever's in
//      `dist/` verbatim into the iOS/Android app's webview directory.
//      Singlefile works there too but multi-file is faster to load
//      (the JS bundle is parsed once and cached). Toggle on with
//      VITE_CAPACITOR=1 npm run build.
//
// To build for the web:    npm run build
// To build for Capacitor:  npm run build:cap   (sets VITE_CAPACITOR=1)
const isCapacitorBuild = process.env.VITE_CAPACITOR === "1";

export default defineConfig({
  plugins: isCapacitorBuild
    ? [react()]
    : [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Inlining knobs only kick in when singlefile is active. Harmless
    // when targeting Capacitor (multi-file build doesn't cross these
    // thresholds anyway since the assets stay external).
    assetsInlineLimit: isCapacitorBuild ? 4096 : 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: !isCapacitorBuild ? false : true,
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
});
