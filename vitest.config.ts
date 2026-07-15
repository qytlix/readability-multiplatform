import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules'],
  },
  resolve: {
    // 与 tsconfig.json 保持一致
    conditions: ['node'],
  },
});