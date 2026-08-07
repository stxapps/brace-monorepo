'use client';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Two boxes rather than one because this is a full-screen surface and
  // bracemark-web has no blanket `.safe-area` div any more (inner-layout.tsx):
  // the outer box owns the background, the height and the insets — it can't also
  // own the `px-4 py-16`, since `safe-area` and a numeric padding utility both
  // emit a plain `padding` declaration and would collide (docs/safe-area.md).
  // `min-h-dvh` rather than the `h-screen` this replaced: `100vh` overstates a
  // mobile viewport by the retracted URL bar, and `min-` lets a long error
  // message grow the page instead of spilling out of a fixed 100vh box.
  return (
    <div className="flex min-h-dvh flex-col bg-white safe-area">
      <div className="flex-1 px-4 py-16 sm:px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
        <div className="mx-auto max-w-max">
          <main className="sm:flex">
            <p className="text-4xl font-extrabold text-red-600 sm:text-5xl">5XX</p>
            <div className="sm:ml-6">
              <div className="sm:border-l sm:border-gray-200 sm:pl-6">
                <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
                  An error occured
                </h1>
                <p className="mt-2.5 text-base text-gray-500">
                  It&apos;s likely to be a network issue. Please wait a moment, check your internet
                  connection and try to refresh the page. If the problem persists, please{' '}
                  <a
                    className="rounded-xs underline hover:text-gray-700 focus:ring-2 focus:ring-gray-400 focus:outline-none"
                    href={'/'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    contact us
                  </a>
                  .
                </p>
                <p className="mt-2.5 text-sm text-gray-500">{error.message}</p>
                <div className="mt-6">
                  <button
                    onClick={() => reset()}
                    className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-red-700 focus:ring focus:outline-none"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
