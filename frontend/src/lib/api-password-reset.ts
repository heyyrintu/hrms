import { api } from '@/lib/api';

export interface ForgotPasswordPayload {
  email: string;
  /** Only needed on deployments that host more than one tenant. */
  tenantCode?: string;
}

export interface ResetPasswordPayload {
  token: string;
  newPassword: string;
}

export interface PasswordResetMessage {
  message: string;
}

/**
 * Both endpoints are public: they run before the user has a token, so the
 * request interceptor in `api.ts` simply has no Authorization header to add.
 */
export const passwordResetApi = {
  async forgotPassword(
    payload: ForgotPasswordPayload,
  ): Promise<PasswordResetMessage> {
    const { data } = await api.post<PasswordResetMessage>(
      '/auth/forgot-password',
      payload,
    );
    return data;
  },

  async resetPassword(
    payload: ResetPasswordPayload,
  ): Promise<PasswordResetMessage> {
    const { data } = await api.post<PasswordResetMessage>(
      '/auth/reset-password',
      payload,
    );
    return data;
  },
};
