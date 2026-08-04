// The web app's origin per build mode — where the extension sends users for the flows
// it doesn't own: account creation (sign-in popup) and browsing the full library
// (complete page). Sessions don't cross origins (the extension does its OWN sign-in —
// docs/browser-extension.md), so a tab opened here may land on bracemark-web's sign-in page first.
export const WEB_APP_URL =
  import.meta.env.MODE === 'production'
    ? 'https://app.bracemark.com'
    : import.meta.env.MODE === 'staging'
      ? 'https://app.staging.bracemark.com'
      : 'http://localhost:3000';
