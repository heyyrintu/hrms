import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '@/contexts/AuthContext';
import { ErrorBoundaryWrapper } from '@/components/ErrorBoundaryWrapper';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Drona Logitech HRMS',
  description: 'Human Resource Management System by Drona Logitech',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className={jakarta.className}>
        <ErrorBoundaryWrapper>
          <AuthProvider>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#FFFFFF',
                  color: '#1A1715',
                  border: '1px solid #EBE8E3',
                  borderRadius: '0.75rem',
                  fontSize: '0.875rem',
                  boxShadow: '0 8px 24px -4px rgba(26, 23, 21, 0.08), 0 2px 8px -2px rgba(26, 23, 21, 0.04)',
                },
                success: {
                  iconTheme: { primary: '#059669', secondary: '#ECFDF5' },
                },
                error: {
                  iconTheme: { primary: '#C53030', secondary: '#FFF5F5' },
                },
              }}
            />
          </AuthProvider>
        </ErrorBoundaryWrapper>
      </body>
    </html>
  );
}
