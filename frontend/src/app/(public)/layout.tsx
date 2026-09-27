/**
 * Public, unauthenticated pages (Keka wave D): careers page, offer answer,
 * pre-onboarding portal. No DashboardLayout, no auth redirect. Pages call
 * `@/lib/api-careers` (its own axios instance, no auth interceptor).
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-warm-50">
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
