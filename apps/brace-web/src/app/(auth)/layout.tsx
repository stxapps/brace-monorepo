// Shared chrome for the auth routes (/create-account, /sign-in): a centered
// card on a full-height background. No nav — these pages are intentionally
// focused.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-800">
        {children}
      </div>
    </div>
  );
}
