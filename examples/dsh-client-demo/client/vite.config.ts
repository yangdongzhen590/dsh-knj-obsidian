import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './'：产物要挂在 dsh web 的 /client-demo 子路径下，相对基准让资源引用跟着路由走
export default defineConfig({
  base: './',
  plugins: [react()],
})
