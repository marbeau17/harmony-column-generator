import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // Default node 環境。jsdom が必要なテストはファイル先頭の
    //   // @vitest-environment jsdom
    // ディレクティブで個別指定する（vitest 2.x 対応）。
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: true,
  },
  // JSX を automatic runtime で変換（React 17+ / Next.js のテスト環境向け）
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
