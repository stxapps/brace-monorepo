import * as React from 'react';
import { render } from '@testing-library/react-native';

import Index from './app/index';

// Lives outside `src/app/` on purpose: every file under the expo-router app
// root becomes a route, and the router's default ignore list only drops
// `+html`/`+api`/`+middleware`/`+native-intent` — not `*.spec.*`. The Home
// screen uses no router hooks, so it renders standalone.
test('renders correctly', () => {
  const { getByTestId } = render(<Index />);
  expect(getByTestId('heading')).toHaveTextContent(/Brace/);
});
