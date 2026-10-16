import { defineConfig } from 'oxfmt'

export default defineConfig({
  semi: false,
  printWidth: 100,
  singleQuote: true,
  jsxSingleQuote: true,
  trailingComma: 'all',
  tabWidth: 2,
  sortImports: true,
  ignorePatterns: ['pnpm-lock.yaml', 'dist/', 'data/', 'config/netprobe.schema.json'],
})
