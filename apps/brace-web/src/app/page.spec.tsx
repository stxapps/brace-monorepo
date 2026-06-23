import React from 'react';
import { render } from '@testing-library/react';

import Page from './page';

// Page renders <AuthedHomeRedirect />, which calls useAuth(). Stub the auth
// context so this stays a provider-free render smoke test: 'unauthenticated'
// means the redirector is a no-op and the landing renders as-is.
jest.mock('@stxapps/web-react', () => ({
  useAuth: () => ({ status: 'unauthenticated' }),
}));

describe('Page', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Page />);
    expect(baseElement).toBeTruthy();
  });
});
