import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      // En développement, l'API Laravel tourne sur :8000 (npm run api).
      // En production, .htaccess envoie /api/... vers api/index.php, qui retire déjà le préfixe.
      '/api': {
        target: 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
