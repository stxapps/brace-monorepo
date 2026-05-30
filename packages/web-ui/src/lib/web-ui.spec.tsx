import { render } from '@testing-library/react';

import StxappsWebUi from './web-ui';

describe('StxappsWebUi', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<StxappsWebUi />);
    expect(baseElement).toBeTruthy();
  });
});
