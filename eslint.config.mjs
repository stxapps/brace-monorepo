import nx from '@nx/eslint-plugin';
import jsoncParser from 'jsonc-eslint-parser';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import prettier from 'eslint-config-prettier/flat';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            // web-ui is a shadcn component library: components self-import its
            // own subpaths (e.g. lib/utils) and apps deep-import components.
            '@stxapps/web-ui/**',
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    // Override or add rules here
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\u0000'], // side-effect imports
            ['^node:'], // node builtins
            ['^react', '^@?\\w'], // external packages, react first
            ['^@stxapps/'], // internal workspace packages
            ['^\\.\\.(?!/?$)', '^\\.\\./?$', '^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'], // relative
            ['^.+\\.s?css$'], // styles last
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          // Build/test/config files aren't shipped — their imports (wxt, vite,
          // eslint, jest, testing-library, next plugins) are dev tooling.
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs}',
            '{projectRoot}/*.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/specs/**/*',
            '{projectRoot}/**/*.spec.{ts,tsx}',
          ],
          // Apps render via the automatic JSX runtime and pull framework
          // runtime deps (react, react-dom, next) in without a direct import,
          // so the "obsolete dependency" direction only yields false positives.
          // Keep the valuable guard: imported packages must be declared.
          checkObsoleteDependencies: false,
        },
      ],
    },
  },
  // Must be last: disables ESLint rules that conflict with Prettier formatting.
  prettier,
];
