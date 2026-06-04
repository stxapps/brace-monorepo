import { Card } from '@stxapps/web-ui/components/ui/card';

// Shared chrome for the auth routes (/create-account, /sign-in): a centered
// card on a full-height background. No nav — these pages are intentionally
// focused. Each page fills the card with its own CardHeader/Content/Footer.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-900">
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  );
}
