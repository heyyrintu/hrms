import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TimesheetsController } from './timesheets.controller';

const proto = TimesheetsController.prototype as unknown as Record<string, unknown>;

/** Method names in declaration order (Nest registers routes in this order). */
const declared = Object.getOwnPropertyNames(proto).filter(
  (n) => n !== 'constructor' && typeof proto[n] === 'function',
);
const pathOf = (name: string): string => Reflect.getMetadata(PATH_METADATA, proto[name] as object);

describe('TimesheetsController', () => {
  it('declares every static GET route before GET :id', () => {
    const idIndex = declared.findIndex((n) => pathOf(n) === ':id');
    expect(idIndex).toBeGreaterThan(-1);
    for (const path of ['me', 'me/list', 'pending-approvals', 'all']) {
      const idx = declared.findIndex((n) => pathOf(n) === path);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(idIndex);
    }
  });

  it('restricts the approver and admin routes by role', () => {
    const roles = (name: string) => Reflect.getMetadata(ROLES_KEY, proto[name] as object);
    expect(roles('getPendingApprovals')).toEqual(['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']);
    expect(roles('approve')).toEqual(['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']);
    expect(roles('reject')).toEqual(['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']);
    expect(roles('listAll')).toEqual(['HR_ADMIN', 'SUPER_ADMIN']);
    expect(roles('getMyWeek')).toBeUndefined();
  });
});
