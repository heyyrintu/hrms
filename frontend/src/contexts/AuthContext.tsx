'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, AuthResponse, LoginCredentials, UserRole } from '@/types';
import apiClient from '@/lib/api-client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
  isManager: boolean;
  isAdmin: boolean;
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
          apiClient.setToken(storedToken);

          // Optionally verify token with backend
          try {
            const freshUser = await apiClient.get<User>('/auth/me');
            setUser(freshUser);
            localStorage.setItem('hrms_user', JSON.stringify(freshUser));
          } catch {
            // Token invalid, clear auth state
            localStorage.removeItem('hrms_token');
            localStorage.removeItem('hrms_user');
            setToken(null);
            setUser(null);
            apiClient.setToken(null);
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

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    
    const { accessToken, user: userData } = response;
    
    // Store in state
    setToken(accessToken);
    setUser(userData);
    
    // Store in localStorage
    localStorage.setItem('hrms_token', accessToken);
    localStorage.setItem('hrms_user', JSON.stringify(userData));
    
    // Set token in API client
    apiClient.setToken(accessToken);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('hrms_token');
    localStorage.removeItem('hrms_user');
    apiClient.setToken(null);
  }, []);

  const hasRole = useCallback((...roles: UserRole[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  const isManager = user?.role === UserRole.MANAGER || 
                    user?.role === UserRole.HR_ADMIN || 
                    user?.role === UserRole.SUPER_ADMIN;

  const isAdmin = user?.role === UserRole.HR_ADMIN || 
                  user?.role === UserRole.SUPER_ADMIN;

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    logout,
    hasRole,
    isManager,
    isAdmin,
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
