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

  it('keeps loggable ahead of every :id route', () => {
    const paths = routes().map((r) => String(r[1]));
    const first = paths.indexOf('loggable');
    paths.forEach((p, i) => {
      if (p.startsWith(':id')) expect(i).toBeGreaterThan(first);
    });
  });

  it.each([
    ['listMembers', 'list'],
    ['addMember', 'add'],
    ['updateMember', 'update'],
    ['removeMember', 'remove'],
  ])('%s delegates to members.%s without a role gate', (handler, method) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[handler])).toBeUndefined();
    const members: any = { list: jest.fn(), add: jest.fn(), update: jest.fn(), remove: jest.fn() };
    const ctrl: any = new ProjectsController({} as any, members, {} as any);
    ctrl[handler]({ tenantId: 't' }, 'p1', 'm1', {});
    expect(members[method]).toHaveBeenCalled();
  });

  it.each([
    ['listTasks', 'list'],
    ['createTask', 'create'],
    ['updateTask', 'update'],
    ['deleteTask', 'remove'],
  ])('%s delegates to tasks.%s without a role gate', async (handler, method) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[handler])).toBeUndefined();
    const tasks: any = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
    const ctrl: any = new ProjectsController({} as any, {} as any, tasks);
    await ctrl[handler]({ tenantId: 't' }, 'p1', 't1', {});
    expect(tasks[method]).toHaveBeenCalled();
  });
});
