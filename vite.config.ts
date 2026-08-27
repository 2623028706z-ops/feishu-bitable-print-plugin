import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2019',
    sourcemap: false,
    // github.io 走 HTTP/2 单条限速管道，手动分包并行拿不到额外带宽，还丢 gzip
    // 跨文件字典 → 首屏总字节反而更大。故不手动分包，保持单主包（gzip 最省）。
    // konva/标签编辑器由 React.lazy() 动态 import 自动拆成异步 chunk，不进首屏。
    chunkSizeWarningLimit: 1800,
  },
});
