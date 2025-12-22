import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * Decorator to extract the current authenticated user from the request
 * Usage: @CurrentUser() user: AuthenticatedUser
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext): AuthenticatedUser | string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      return undefined;
    }

    return data ? user[data] : user;
  },
);
