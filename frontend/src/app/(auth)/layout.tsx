export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-warm-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative background elements — responsive sizes */}
      <div className="absolute top-0 right-0 -translate-y-1/4 translate-x-1/4 w-72 sm:w-96 md:w-[600px] h-72 sm:h-96 md:h-[600px] rounded-full bg-gradient-to-br from-primary-100/40 to-accent-100/30 blur-3xl" />
      <div className="absolute bottom-0 left-0 translate-y-1/4 -translate-x-1/4 w-64 sm:w-80 md:w-[500px] h-64 sm:h-80 md:h-[500px] rounded-full bg-gradient-to-tr from-accent-100/30 to-primary-100/20 blur-3xl" />
      <div className="relative z-10 w-full flex justify-center">
        {children}
      </div>
    </div>
  );
}
