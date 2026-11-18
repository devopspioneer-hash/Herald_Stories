// ESLint 9 flat config. Formatting is Prettier's job — eslint-config-prettier turns off clashing rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'src/api/types/**'] },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // General
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // AGENTS.md security rules
      'react/no-danger': 'error', // no dangerouslySetInnerHTML
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Never store tokens in web storage (AGENTS.md §3).' },
        { name: 'sessionStorage', message: 'Never store tokens in web storage (AGENTS.md §3).' },
        { name: 'fetch', message: 'Use src/api/client.ts + TanStack Query hooks.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'rehype-raw', message: 'Raw HTML in Markdown is forbidden.' }],
        },
      ],
    },
  },

  // The API client is the one place allowed to call fetch.
  {
    files: ['src/api/client.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },

  // Node-side config files
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
