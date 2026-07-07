import { CheckoutEventNames, initializePaddle, type Paddle } from '@paddle/paddle-js';

// App-level Paddle Billing wrapper — brace-web is the ONLY checkout surface
// (the extension deep-links here; the future Expo app uses store IAP), so this
// lives in the app, not a package. It wraps @paddle/paddle-js with:
//  - a lazy singleton: Paddle.js is a third-party script, loaded only when the
//    subscription section actually needs it, never on app boot;
//  - the checkout lifecycle callbacks the subscription UI cares about, routed
//    from Paddle's global eventCallback (registered once at initialization) to
//    the currently-open checkout's handlers.
//
// The checkout itself opens on a SERVER-created transaction id (POST
// /v1/iap/checkout): the server stamps the account binding (custom_data.userId)
// and the price — see the contract note in @stxapps/shared iap/endpoints.ts.
// Payment completion reaches brace-api via Paddle's webhook, NOT this client;
// the UI just polls `iap/status` after `onCompleted` until the plan flips.
//
// NEXT_PUBLIC_PADDLE_ENV / NEXT_PUBLIC_PADDLE_CLIENT_TOKEN are bundler-inlined
// per tier (see .env.*; client tokens are public by design). The literal
// `process.env.…` access must stay here in app code for Next to inline it.

let paddlePromise: Promise<Paddle | undefined> | null = null;

// The open checkout's handlers. Paddle's eventCallback is global (bound once at
// init), so the per-open callbacks are held here; only one overlay checkout can
// be open at a time.
let onCompleted: (() => void) | null = null;
let onClosed: (() => void) | null = null;

function getPaddle(): Promise<Paddle | undefined> {
  if (!paddlePromise) {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) throw new Error('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set');

    paddlePromise = initializePaddle({
      environment: process.env.NEXT_PUBLIC_PADDLE_ENV === 'production' ? 'production' : 'sandbox',
      token,
      eventCallback: (event) => {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) onCompleted?.();
        // `closed` fires for BOTH outcomes — after completion and on abandon —
        // so the UI treats it as "overlay gone", not "purchase canceled".
        if (event.name === CheckoutEventNames.CHECKOUT_CLOSED) onClosed?.();
      },
    });
  }
  return paddlePromise;
}

// Open the overlay checkout for a server-created transaction. `onCompleted`
// fires when payment succeeds (start polling `iap/status`); `onClosed` when the
// overlay goes away for any reason (clear busy state).
export async function openPaddleCheckout(options: {
  transactionId: string;
  onCompleted: () => void;
  onClosed: () => void;
}): Promise<void> {
  const paddle = await getPaddle();
  if (!paddle) throw new Error('Paddle failed to initialize');

  onCompleted = options.onCompleted;
  onClosed = options.onClosed;
  paddle.Checkout.open({ transactionId: options.transactionId });
}
