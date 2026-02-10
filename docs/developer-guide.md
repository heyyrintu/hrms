# Developer Guide

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **PostgreSQL** 14+
- **Redis** (optional — for background job processing via BullMQ)
- **npm** (comes with Node.js)

## First-Run Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd hrms

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and JWT_SECRET

# Frontend
cd ../frontend
cp .env.example .env
# Default values work for local development
```

### 3. Database Setup

```bash
cd backend

# Generate Prisma client from schema
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed with demo data (4 demo users, sample departments, etc.)
npm run prisma:seed
```

### 4. Start Development Servers

```bash
# Terminal 1: Backend (http://localhost:3001)
cd backend
npm run start:dev

# Terminal 2: Frontend (http://localhost:3000)
cd frontend
npm run dev
```

### 5. Verify Setup
- Frontend: http://localhost:3000 — should show login page
- Backend API: http://localhost:3001/api/auth/login — should accept POST
- Swagger docs: http://localhost:3001/api/docs — interactive API explorer
- Login with: admin@example.com / password123

## Backend Development Workflow

### Creating a New Module

1. Generate the module scaffold:
   ```bash
   cd backend
   npx nest generate module modules/my-feature
   npx nest generate controller modules/my-feature
   npx nest generate service modules/my-feature
   ```

2. Register in `src/app.module.ts` (auto-done by nest CLI)

3. Create DTOs in `modules/my-feature/dto/`:
   - Use `class-validator` decorators for validation
   - Use `@ApiProperty()` / `@ApiPropertyOptional()` for Swagger docs

4. Add Swagger decorators to the controller:
   - `@ApiTags('my-feature')` on the class
   - `@ApiBearerAuth()` on the class (if authenticated)
   - `@ApiOperation({ summary: '...' })` on each method
   - `@ApiResponse({ status: ..., description: '...' })` for responses

5. Add the new tag to `src/main.ts` Swagger configuration

### Prisma Schema Changes

```bash
# 1. Edit backend/prisma/schema.prisma
# 2. Generate migration
npm run prisma:migrate
# 3. Regenerate client (required after any schema change)
npm run prisma:generate
```

### Service Pattern
All services inject `PrismaService` and scope queries by `tenantId`:

```typescript
@Injectable()
export class MyFeatureService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.myModel.findMany({
      where: { tenantId },
    });
  }
}
```

### Guard Usage
```typescript
@Controller('my-feature')
@ApiTags('my-feature')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class MyFeatureController {
  // All users can access
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {}

  // Only HR_ADMIN and SUPER_ADMIN
  @Post()
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  create() {}
}
```

## Frontend Development Workflow

### Creating a New Page

1. Create the page file at `src/app/(protected)/my-feature/page.tsx`
2. Add the route to the Sidebar navigation in `src/components/layout/Sidebar.tsx`:
   ```typescript
   { label: 'My Feature', path: '/my-feature', icon: SomeIcon, roles: [UserRole.HR_ADMIN] }
   ```
3. Create any feature-specific components in `src/components/my-feature/`

### API Calls
Use the unified API client from `src/lib/api.ts`:

```typescript
import { api } from '@/lib/api';

// GET request
const response = await api.get('/my-feature');
const data = response.data;  // Axios wraps response in { data }

// POST request
await api.post('/my-feature', { name: 'test' });
```

### Form Pattern
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
});

function MyForm() {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });
  // ...
}
```

## Testing

### Running Tests

```bash
# Backend (823 tests)
cd backend
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:cov      # With coverage report

# Frontend (255 tests)
cd frontend
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:cov      # With coverage report
```

### Backend Test Patterns

Test files live alongside source files as `*.spec.ts`:

```
modules/auth/
  ├── auth.controller.ts
  ├── auth.controller.spec.ts    # Controller tests
  ├── auth.service.ts
  └── auth.service.spec.ts       # Service tests
```

Use the mock Prisma service factory from `src/test/helpers/prisma-mock.ts`:

```typescript
import { createMockPrismaService } from '../../test/helpers/prisma-mock';

const mockPrisma = createMockPrismaService(['user', 'employee']);
```

### Frontend Test Patterns

Test files live alongside components as `*.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## Common Pitfalls

1. **Prisma client must be regenerated after schema changes**
   ```bash
   npx prisma generate  # Run this after any schema.prisma change
   ```

2. **Axios returns `{ data }` wrapper** — always access `.data`:
   ```typescript
   const response = await api.get('/endpoint');
   const items = response.data;  // NOT just response
   ```

3. **JSX is not allowed in `.ts` files** — use `.tsx` for React components, or use `React.createElement()` in `.ts` files

4. **Dynamic Tailwind classes don't work** — `md:col-span-${n}` won't be included in the CSS bundle. Use a safelist in `tailwind.config.ts` or use predefined classes.

5. **Don't call mock service methods twice in tests** — `mockResolvedValueOnce` values are consumed on each call

6. **Use UTC noon dates in tests** to avoid timezone-related shifts:
   ```typescript
   new Date('2025-03-15T12:00:00Z')  // Use noon UTC, not midnight
   ```

7. **`react-error-boundary` FallbackProps has `error: unknown`** — use a type guard, not direct casting

8. **FormRow/TableHead components have optional props** — check the component interface when reusing across pages

## Available npm Scripts

### Backend
| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start with hot reload |
| `npm run build` | Build for production |
| `npm run start:prod` | Start production build |
| `npm test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run E2E tests |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run migrations |
| `npm run prisma:seed` | Seed database |
| `npm run prisma:studio` | Open Prisma Studio GUI |

### Frontend
| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Build for production |
| `npm run start` | Start production build |
| `npm test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run lint` | Run Next.js linter |
