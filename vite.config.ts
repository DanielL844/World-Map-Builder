import { defineConfig } from 'vite';

// base: './' so a production build can be opened from any path / wrapped in a desktop shell.
// server.host: true exposes the dev server on your LAN so you can open it on your phone for stylus testing.
export default defineConfig({
  base: './',
  server: { host: true },
});
