import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../../common/permissions/require-permissions.decorator';
import { ProjectsController } from './projects.controller';

const proto = ProjectsController.prototype as any;

/** Route handlers in declaration order, as `[httpMethod, path, handlerName]`. */
function routes() {
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[n]))
    .map((n) => [Reflect.getMetadata(METHOD_METADATA, proto[n]), Reflect.getMetadata(PATH_METADATA, proto[n]), n]);
}

describe('ProjectsController routing', () => {
  it('declares GET loggable before GET :id', () => {
    const gets = routes().filter((r) => r[0] === 0); // RequestMethod.GET
    const paths = gets.map((r) => r[1]);
    expect(paths.indexOf('loggable')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('loggable')).toBeLessThan(paths.indexOf(':id'));
  });

  it('has no class-level @Roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProjectsController)).toBeUndefined();
  });

  it.each(['create', 'update'])('%s is admin-only with projects.manage', (name) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[name])).toEqual(['SUPER_ADMIN', 'HR_ADMIN']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name])).toEqual(['projects.manage']);
  });

  it.each(['list', 'loggable', 'get'])('%s has no role restriction', (name) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[name])).toBeUndefined();
  });
});
