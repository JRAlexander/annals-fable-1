import { defineConfig } from 'vite';

// Relative base so the static build works on GitHub Pages under any repo name.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
