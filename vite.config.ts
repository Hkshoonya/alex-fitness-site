import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
// inspectAttr() injects code-path="src/Foo.tsx:LL:CC" attributes into the
// rendered DOM for in-page inspection. Useful in dev, but in production it
// leaks file paths to every visitor and signals the build is unfinished. M-04
// fix: dev-only by gating on the vite command (serve = dev, build = prod).
// `base` controls the asset prefix baked into the bundle (script/CSS URLs).
// - Default '/alex-fitness-site/' targets the current GitHub Pages sub-path
//   deploy at hkshoonya.github.io/alex-fitness-site/.
// - For the apex cutover to alexsfitness.com (or any root deploy), build with:
//     VITE_BASE=/ npm run build
//   Setting it via env keeps both deploy targets working from one config.
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE || '/alex-fitness-site/',
  plugins: command === 'serve' ? [inspectAttr(), react()] : [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
