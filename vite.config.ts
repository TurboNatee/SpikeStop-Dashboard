import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    allowedHosts: true,
    host: true
  },
  preview: {
    allowedHosts: true,
    host: true
  }
});