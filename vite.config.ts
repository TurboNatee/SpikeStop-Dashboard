import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    allowedHosts: ['spikestop-ecs-alb-68265514.eu-north-1.elb.amazonaws.com'],
    host: true
  },
  preview: {
    allowedHosts: ['spikestop-ecs-alb-68265514.eu-north-1.elb.amazonaws.com'],
    host: true
  }
});