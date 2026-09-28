import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { SsoProvider } from '@prisma/client';

const ROUTE_PROVIDERS: Record<string, SsoProvider> = {
  google: SsoProvider.GOOGLE,
  microsoft: SsoProvider.MICROSOFT,
};

/**
 * Maps the lower-case `:provider` route segment (`google` / `microsoft`) to
 * the `SsoProvider` enum, 400ing on anything else. `ParseEnumPipe` cannot be
 * used directly because it compares case-sensitively against the enum's
 * own (upper-case) values. Shared by `SsoController` and
 * `SsoConfigController`. Owned by WS-3 (plan Tasks 3.1/3.3-3.5).
 */
@Injectable()
export class SsoProviderParamPipe implements PipeTransform<string, SsoProvider> {
  transform(value: string): SsoProvider {
    const provider = ROUTE_PROVIDERS[(value ?? '').toLowerCase()];
    if (!provider) {
      throw new BadRequestException(`Unknown SSO provider: ${value}`);
    }
    return provider;
  }
}
