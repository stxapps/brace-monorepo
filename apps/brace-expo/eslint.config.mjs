import nx from '@nx/eslint-plugin';

import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/react'],
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {
      // expo-status-bar's <StatusBar style="auto" /> uses `style` as a string
      // enum, not a style object — allow-list it for this rule.
      'react/style-prop-object': ['warn', { allow: ['StatusBar'] }],
    },
  },
  {
    ignores: ['.expo', 'web-build', 'cache', 'dist', '**/out-tsc'],
  },
];
