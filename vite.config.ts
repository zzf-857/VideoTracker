import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/renderer'), // 指定渲染进程根目录，以使 Vite 能找到 index.html
  base: './', // 确保在 Electron 的 file:// 协议下资源使用相对路径加载
  build: {
    outDir: path.resolve(__dirname, 'dist'), // 编译输出到根目录下的 dist
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  }
});
