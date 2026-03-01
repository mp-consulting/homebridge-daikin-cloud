import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignores
  {
    ignores: ['dist/**', 'node_modules/**', 'test/test-*.js'],
  },
  // Base recommended configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Language options
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  // Core rules
  {
    rules: {
      // Style
      'quotes': ['error', 'single', { avoidEscape: true }],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'linebreak-style': ['error', 'unix'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'max-len': ['error', { code: 160, ignoreUrls: true, ignoreStrings: true }],

      // Best practices
      'dot-notation': 'error',
      'eqeqeq': ['error', 'smart'],
      'curly': ['error', 'all'],
      'brace-style': ['error', '1tbs'],
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // TypeScript
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { classes: false, enums: false, functions: false }],
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  // Test files — relaxed rules
  {
    files: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts', 'src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'max-len': 'off',
    },
  },
  // Test helper files — relaxed rules
  {
    files: ['test/helpers/**/*.ts', 'test/fixtures/**/*.ts', 'test/mocks/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'max-len': 'off',
    },
  },
  // homebridge-ui browser globals
  {
    files: ['homebridge-ui/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        homebridge: 'readonly',
        bootstrap: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // homebridge-ui server globals
  {
    files: ['homebridge-ui/server.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'off',
    },
  },
);
