import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'SUPER_ADMIN' | 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  employeeId?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  isAdmin: () => boolean;
  isManager: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      setAuth: (token: string, user: User) => {
        localStorage.setItem('token', token);
        set({ token, user, isAuthenticated: true });
      },
      logout: () => {
        localStorage.removeItem('token');
        set({ token: null, user: null, isAuthenticated: false });
      },
      isAdmin: () => {
        const { user } = get();
        return user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ADMIN';
      },
      isManager: () => {
        const { user } = get();
        return user?.role === 'MANAGER' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ADMIN';
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
