// The web app's origin per build mode — where the extension sends users for the flows
// it doesn't own: account creation (sign-in popup) and browsing the full library
// (complete page). Sessions don't cross origins (the extension does its OWN sign-in —
// docs/browser-extension.md), so a tab opened here may land on brace-web's sign-in page first.
export const WEB_APP_URL =
  import.meta.env.MODE === 'production'
    ? 'https://app.brace.to'
    : import.meta.env.MODE === 'staging'
      ? 'https://app.staging.brace.to'
      : 'http://localhost:3000';
