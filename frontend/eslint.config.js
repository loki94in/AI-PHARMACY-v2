import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Empty catch blocks are an intentional silent-fail pattern in this
      // codebase (localStorage/theme reads that must never throw).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Underscore prefix = deliberately ignored binding (codebase convention).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  {
    // react-hooks/globals: module-level variable caches are MANDATED by the root
    // AGENTS.md "SPA Performance & Database Search Contract" (module-level cache
    // hydration so kept-alive pages paint instantly without refetch storms).
    // These components write their persistent caches from event/effect flows.
    files: [
      'src/components/LiveCartAddModal.tsx',
      'src/components/WhatsAppQueuePopover.tsx',
      'src/pages/PharmarackCart/index.tsx',
    ],
    rules: {
      'react-hooks/globals': 'off',
    },
  },
  {
    // exhaustive-deps in LiveCartAddModal: its memoized derivations and mount
    // effects intentionally read the mandated module caches above; adding
    // component-scope helper functions as deps would defeat that memoization
    // contract (helpers change identity every render).
    files: ['src/components/LiveCartAddModal.tsx'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // PharmarackCart tiered loaders ("3-tier order avoids saturating the
    // network on mount") hydrate module caches and are refreshed by SSE push;
    // setState happens inside async loaders / timeout tiers, which the rule
    // cannot see through. Same module-cache memoization rationale as above.
    files: ['src/pages/PharmarackCart/index.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // react-hooks/incompatible-library: @tanstack/react-virtual returns
    // non-memoizable functions by design; the compiler cannot memoize it.
    // This wrapper is the single sanctioned integration point.
    files: ['src/hooks/useVirtualizer.ts'],
    rules: {
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    // React Compiler + effect-flow exception zones documented in
    // frontend/AGENTS.md ("Lint Debt Policy", 2026-08-23) and the root
    // AGENTS.md SSE/P1 contracts: Layout orchestrates sanctioned SSE
    // CustomEvent refreshes, throttled focus/visibility reloads, module-cache
    // hydration and timer tiers whose setState calls happen inside async
    // loaders the rule cannot see through. PharmarackCart shares the same
    // tiered-loader/module-cache design. Tolerated ONLY in these two files
    // (plus the concurrent-edit pages excluded elsewhere).
    files: [
      'src/components/Layout.tsx',
      'src/pages/PharmarackCart/index.tsx',
    ],
    rules: {
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
