import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['common/tools/任务表/test/**/*.test.ts'],
    environment: 'node',
    globals: true,
    reporters: ['verbose'],
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
  },
})