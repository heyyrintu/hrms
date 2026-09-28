'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, AuthResponse, UserRole } from '@/types';
import { api, authApi } from '@/lib/api';

/**
 * Password login can finish right away, or stop at a second-factor step
 * (Keka wave H1). The caller (the login page) switches on `status`.
 */
export type LoginOutcome =
  | { status: 'done' }
  | { status: 'mfa'; mfaToken: string }
  | { status: 'enrol'; enrolToken: string };

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, tenantCode?: string | null) => Promise<LoginOutcome>;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
  /** True when one of the user's custom roles grants this permission (Keka wave H1). */
  hasPermission: (permission?: string) => boolean;
  /** Store a finished sign-in (password, 2FA or SSO) exactly as login does. */
  completeSession: (response: AuthResponse) => void;
  isManager: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedToken = localStorage.getItem('hrms_token');
        const storedUser = localStorage.getItem('hrms_user');

        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));

          // Optionally verify token with backend
          try {
            const response = await authApi.getProfile();
            setUser(response.data);
            localStorage.setItem('hrms_user', JSON.stringify(response.data));
          } catch {
            // Token invalid, clear auth state
            localStorage.removeItem('hrms_token');
            localStorage.removeItem('hrms_user');
            setToken(null);
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const completeSession = useCallback((response: AuthResponse) => {
    const { accessToken, user: userData } = response;

    // Store in state
    setToken(accessToken);
    setUser(userData);

    // Store in localStorage
    localStorage.setItem('hrms_token', accessToken);
    localStorage.setItem('hrms_user', JSON.stringify(userData));
  }, []);

  const login = useCallback(
    async (email: string, password: string, tenantCode?: string | null): Promise<LoginOutcome> => {
      const response = await authApi.login(email, password, tenantCode ?? undefined);
      const data = response.data as
        | AuthResponse
        | { mfaRequired: true; mfaToken: string }
        | { enrolmentRequired: true; enrolToken: string };

      if ('mfaRequired' in data && data.mfaRequired) {
        return { status: 'mfa', mfaToken: data.mfaToken };
      }
      if ('enrolmentRequired' in data && data.enrolmentRequired) {
        return { status: 'enrol', enrolToken: data.enrolToken };
      }

      completeSession(data as AuthResponse);
      return { status: 'done' };
    },
    [completeSession],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('hrms_token');
    localStorage.removeItem('hrms_user');
  }, []);

  const hasRole = useCallback((...roles: UserRole[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  const hasPermission = useCallback((permission?: string) => {
    if (!user || !permission) return false;
    return (user.permissions ?? []).includes(permission);
  }, [user]);

  const isManager = user?.role === UserRole.MANAGER || 
                    user?.role === UserRole.HR_ADMIN || 
                    user?.role === UserRole.SUPER_ADMIN;

  const isAdmin = user?.role === UserRole.HR_ADMIN || 
                  user?.role === UserRole.SUPER_ADMIN;

  const isSuperAdmin = user?.role === UserRole.SUPER_ADMIN;

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    logout,
    hasRole,
    hasPermission,
    completeSession,
    isManager,
    isAdmin,
    isSuperAdmin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
