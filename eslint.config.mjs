import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.npm-cache/**', '.test-results/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)) },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-debugger': 'error',
      'no-constant-binary-expression': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true, ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
];
