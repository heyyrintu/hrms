# HRMS Mobile Redesign Plan

## Goal
Make the HRMS webapp fully mobile-responsive with a modern, clean design. Brand colors: red (#E53E3E) and yellowish-orange (#ED8936) — already configured.

## Scope
- 39 page files (1 root, 1 login, 37 protected pages)
- 13 UI components
- 3 layout components (Sidebar, Header, DashboardLayout)
- 38 files still using `gray-*` classes that need `warm-*` migration
- Tailwind config, globals CSS, viewport meta

---

## Phase 0: Discovery (COMPLETE)

### Findings Summary
**Critical Issues:**
1. No Next.js viewport export in root layout
2. Header notification dropdown `w-80` (320px) overflows small screens
3. Dynamic Tailwind classes broken (`md:col-span-${n}` in FormRow)
4. Tables with 6-9 columns overflow on mobile (all major pages)
5. Sidebar fixed at `w-[260px]` — takes 70%+ of small screens

**High Issues:**
6. Toast position `top-right` overlaps mobile header
7. No responsive typography (fixed text sizes everywhere)
8. Table cells use `whitespace-nowrap` forcing horizontal scroll
9. Input/Select height 40px (should be 44px+ for touch targets)
10. Auth layout decorative elements use fixed 600px/500px sizes

**Medium Issues:**
11. Stats grids jump from 1-col to 4-col (missing `sm:grid-cols-2`)
12. FormGrid missing `sm:` breakpoint
13. Modal doesn't go full-screen on mobile
14. No bottom nav for mobile

### Files Reference
- `tailwind.config.ts` — Line 86-88: No safelist, no responsive extensions
- `src/app/layout.tsx` — Line 14-17: No viewport export
- `src/app/globals.css` — Lines 42-123: Component classes with no responsive variants
- `src/components/layout/Sidebar.tsx` — Line 270: `w-[260px]` fixed
- `src/components/layout/Header.tsx` — Line 151: `w-80` dropdown
- `src/components/ui/Table.tsx` — Line 91: `whitespace-nowrap` on cells
- `src/components/ui/FormRow.tsx` — Line 13: Dynamic class bug
- `src/components/ui/Modal.tsx` — Lines 17-22: No mobile sizing

---

## Phase 1: Foundation — Viewport, Tailwind Config, CSS Globals

### What to implement
1. **Add Next.js viewport export** to `src/app/layout.tsx`
   - Add `import type { Viewport } from 'next'`
   - Add `export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 }`

2. **Update `tailwind.config.ts`**
   - Add `safelist` for dynamic col-span classes: `md:col-span-1` through `md:col-span-4`
   - Add responsive font size scale: `fontSize` with `clamp()` values
   - Add custom screen utilities if needed (e.g., `xs: '375px'`)

3. **Update `src/app/globals.css`**
   - Make `.btn-md` touch-friendly: `h-10 md:h-10` → `h-11 md:h-10` (44px mobile)
   - Make `.btn-sm` touch-friendly: `h-8` → `h-9 md:h-8` (36px mobile)
   - Make `.input` touch-friendly: `h-10` → `h-11 md:h-10` (44px mobile)
   - Add responsive heading styles: `h1 { @apply text-xl sm:text-2xl }` etc.
   - Add mobile-specific utility: `.safe-bottom { padding-bottom: env(safe-area-inset-bottom) }`
   - Add scroll-shadow utility for tables

4. **Update toast position** in `src/app/layout.tsx`
   - Change `position="top-right"` to `position="top-center"` (works better on mobile)

### Verification
- [ ] `npx next build` passes
- [ ] Viewport meta tag renders in HTML head
- [ ] Touch targets >= 44px on mobile
- [ ] Dynamic col-span classes render correctly

### Anti-patterns
- Do NOT use `viewport` in `metadata` object (deprecated in Next.js 14+)
- Do NOT set `maximum-scale=1` (breaks accessibility zoom)
- Do NOT use `user-scalable=no`

---

## Phase 2: Layout Components — Sidebar, Header, DashboardLayout

### What to implement

#### 2A. Sidebar (`src/components/layout/Sidebar.tsx`)
- Reduce mobile drawer width: `w-[260px]` → `w-[280px] sm:w-[280px]` (keep consistent, just ensure it's not bigger)
- Actually 280px is fine for modern phones (375px+). Keep `w-[260px]`.
- Add safe area inset: `pb-[env(safe-area-inset-bottom)]` on sidebar bottom
- Make nav item font size slightly larger on mobile: `text-[13px]` → `text-sm` (14px)
- Add haptic-like active feedback: items already have `active:scale-[0.98]` from btn — ensure nav items get similar
- Smooth scroll on the sidebar overflow area

#### 2B. Header (`src/components/layout/Header.tsx`)
- **Critical**: Fix notification dropdown width: `w-80` → `w-[calc(100vw-2rem)] sm:w-80`
- **Critical**: Fix user dropdown width: `w-52` → `w-[calc(100vw-2rem)] sm:w-52`
- Both dropdowns: change `absolute right-0` to `fixed sm:absolute` on mobile with centered positioning
- OR simpler: keep `absolute right-0` but add `max-w-[calc(100vw-2rem)]` and adjust `right` value
- Make header padding responsive: `px-4 lg:px-6` is fine (already responsive)
- Add `backdrop-blur-md` sticky behavior confirmation (already has this)

#### 2C. DashboardLayout (`src/components/layout/DashboardLayout.tsx`)
- Update main padding: `p-4 lg:p-8` → `p-3 sm:p-4 lg:p-8` (tighter on phones)
- Add safe area bottom padding for iOS

### Verification
- [ ] Sidebar doesn't exceed viewport width on 375px screen
- [ ] Notification dropdown fits on 320px screen
- [ ] Content area has proper padding on mobile
- [ ] No horizontal overflow on any screen size

---

## Phase 3: UI Components — Table, Modal, FormRow, Input, Select

### What to implement

#### 3A. Table (`src/components/ui/Table.tsx`)
- Remove `whitespace-nowrap` from `TableCell` default (let text wrap on mobile)
- Add optional `nowrap` prop to `TableCell` for columns that need it
- Add scroll shadow indicators: left/right gradient shadows when table overflows
- Add `data-label` support for potential card-view on mobile (future)
- Add responsive cell padding: `px-4 py-3` → `px-3 py-2.5 sm:px-4 sm:py-3`
- Add `TableHead` responsive: hide non-essential columns with `hidden sm:table-cell` support

#### 3B. Modal (`src/components/ui/Modal.tsx`)
- On mobile, modal should be near-full-screen: add `sm:max-w-*` variants
- Update size classes:
  - `sm`: `max-w-[calc(100vw-2rem)] sm:max-w-sm`
  - `md`: `max-w-[calc(100vw-2rem)] sm:max-w-md`
  - `lg`: `max-w-[calc(100vw-2rem)] sm:max-w-lg`
  - `xl`: `max-w-[calc(100vw-2rem)] sm:max-w-xl`
  - `2xl`: `max-w-[calc(100vw-2rem)] sm:max-w-2xl`
- Make modal body scrollable with `max-h-[80vh] overflow-y-auto` on mobile
- Responsive padding: `p-5` → `p-4 sm:p-5`

#### 3C. FormRow/FormGrid (`src/components/ui/FormRow.tsx`)
- Fix dynamic colSpan: replace `md:col-span-${colSpan}` with a lookup map
- Update FormGrid colClasses to include `sm:` breakpoint:
  - 2: `'grid-cols-1 sm:grid-cols-2'`
  - 3: `'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'`
  - 4: `'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'`
- Reduce form gap on mobile: `gap-4` → `gap-3 sm:gap-4`

#### 3D. Input (`src/components/ui/Input.tsx`)
- Already updated in globals.css (Phase 1) for height
- Label font size is fine (`text-sm`)
- No additional changes needed if globals.css handles it

#### 3E. Select (`src/components/ui/Select.tsx`)
- Match input height changes from globals.css
- Ensure select dropdown is touch-friendly (native select is fine)

#### 3F. Card (`src/components/ui/Card.tsx`)
- Make padding responsive: if Card uses `p-6`, change to `p-4 sm:p-6`
- Read Card component to check current padding

#### 3G. BulkApprovalBar (`src/components/leave/BulkApprovalBar.tsx`)
- Stack buttons vertically on mobile: `flex flex-col sm:flex-row`
- Adjust text: hide "Selected" on mobile, keep count + icons
- Fix `lg:left-64` to match sidebar width

### Verification
- [ ] Tables scroll horizontally with visual shadow indicators
- [ ] Modal fills screen properly on 375px devices
- [ ] Forms are single-column on mobile, expand at breakpoints
- [ ] All touch targets >= 44px
- [ ] BulkApprovalBar buttons don't overflow

---

## Phase 4: Page Fixes Batch 1 — Core Pages

### Pages to update (6 pages)
For EACH page: migrate `gray-*` → `warm-*` AND add responsive classes.

#### 4A. Dashboard (`dashboard/page.tsx`)
- Stats grids: `md:grid-cols-2 lg:grid-cols-4` → `sm:grid-cols-2 lg:grid-cols-4` (2-col on tablet)
- Attendance card: ensure `flex-col sm:flex-row` wrapping
- Clock in/out buttons: `flex-wrap gap-2`
- Page header: `text-xl sm:text-2xl` responsive heading
- All `gray-*` → `warm-*`

#### 4B. Employees (`employees/page.tsx`)
- Stats grid: add `sm:grid-cols-2`
- Table: hide non-essential columns on mobile (Code, Department, Type, Tenure → `hidden sm:table-cell` or `hidden lg:table-cell`)
- Keep visible on mobile: Employee name, Status, Actions
- Filter grid: `sm:grid-cols-2 md:grid-cols-3`
- Modal forms: ensure `FormGrid cols` works with responsive
- Expanded row: `sm:grid-cols-2 md:grid-cols-4`
- All `gray-*` → `warm-*`

#### 4C. Attendance (`attendance/page.tsx`)
- Table: hide OT columns on mobile, keep Date, Status, Clock In/Out
- Month nav: `flex-wrap gap-2`
- Filter row: `sm:grid-cols-2 md:grid-cols-3`
- All `gray-*` → `warm-*`

#### 4D. Leave (`leave/page.tsx`)
- Balance card stats: `grid-cols-2 sm:grid-cols-3`
- Leave request cards: responsive detail grid
- All `gray-*` → `warm-*`

#### 4E. Leave Request (`leave/request/page.tsx`)
- Form layout single-column on mobile
- All `gray-*` → `warm-*`

#### 4F. Leave Approvals (`leave/approvals/page.tsx`)
- Table responsive columns
- All `gray-*` → `warm-*`

### Verification
- [ ] All 6 pages have no `gray-*` classes remaining
- [ ] Stats grids show 2-col on sm (640px+)
- [ ] Tables are usable on 375px screen (essential columns visible, rest scrollable)
- [ ] `npx next build` passes

---

## Phase 5: Page Fixes Batch 2 — Secondary Pages

### Pages to update (8 pages)

#### 5A. Companies (`companies/page.tsx`)
- Stats grid responsive
- Table: hide columns on mobile (Code, Users, Departments, Created)
- Filter: stack on mobile
- All `gray-*` → `warm-*`

#### 5B. Payroll (`payroll/page.tsx`)
- Stats: responsive grid
- Table: hide Employees, Deductions on mobile
- Action buttons: icon-only on mobile
- All `gray-*` → `warm-*`

#### 5C. Payroll Structures (`payroll/structures/page.tsx`)
- All `gray-*` → `warm-*`
- Responsive layout

#### 5D. Payroll Run Detail (`payroll/runs/[id]/page.tsx`)
- All `gray-*` → `warm-*`
- Table responsive

#### 5E. Expenses (`expenses/page.tsx`)
- Table: responsive columns
- Filter: stack on mobile
- Modal form: responsive
- All `gray-*` → `warm-*`

#### 5F. Performance (`performance/page.tsx`)
- Reviews table: hide non-essential columns
- Goals table: responsive
- Star ratings: ensure touch-friendly
- All `gray-*` → `warm-*`

#### 5G. Performance Team (`performance/team/page.tsx`)
- All `gray-*` → `warm-*`

#### 5H. Performance Cycles (`performance/cycles/page.tsx`)
- All `gray-*` → `warm-*`

### Verification
- [ ] All 8 pages have no `gray-*` classes remaining
- [ ] Tables usable on mobile
- [ ] `npx next build` passes

---

## Phase 6: Page Fixes Batch 3 — Admin & Remaining Pages

### Pages to update (20+ pages)

#### Admin pages (10 pages)
- `admin/announcements/page.tsx`
- `admin/audit/page.tsx`
- `admin/expense-categories/page.tsx`
- `admin/holidays/page.tsx`
- `admin/leave-types/page.tsx`
- `admin/leave-balances/page.tsx`
- `admin/leave-analytics/page.tsx`
- `admin/accrual-rules/page.tsx`
- `admin/accrual-history/page.tsx`
- `admin/onboarding-templates/page.tsx`
- `admin/shifts/page.tsx`

#### Other pages (8 pages)
- `my-profile/page.tsx` — Profile card responsive, document table
- `my-payslips/page.tsx` — Payslip table responsive
- `notifications/page.tsx` — Notification list responsive
- `reports/page.tsx` — Report cards responsive, date picker grids
- `approvals/expenses/page.tsx`
- `approvals/change-requests/page.tsx`
- `approvals/ot/page.tsx`
- `onboarding/page.tsx` + `onboarding/my-tasks/page.tsx`
- `employees/new/page.tsx` — New employee form responsive
- `employees/[id]/edit/page.tsx` — Edit form responsive
- `leave/calendar/page.tsx` — Calendar responsive

For ALL pages:
- Migrate all `gray-*` → `warm-*`
- Add responsive breakpoints to grids
- Ensure page headers use `flex-col sm:flex-row`
- Tables: add responsive column visibility
- Forms: ensure single-column on mobile

### Verification
- [ ] `grep -r "gray-" frontend/src/app/` returns 0 results (excluding test files)
- [ ] All pages render without horizontal overflow
- [ ] `npx next build` passes

---

## Phase 7: Mobile UX Polish

### What to implement
1. **Bottom safe area** — Add safe-area padding for iOS devices with home indicator
2. **Improved scroll behavior** — `scroll-smooth` on main content, `overscroll-behavior: contain` on sidebar
3. **Touch feedback** — Ensure all interactive elements have `:active` feedback
4. **Loading states** — Skeleton loading for tables on mobile
5. **Empty states** — Responsive empty state illustrations
6. **Auth layout** — Reduce decorative circle sizes on mobile: `w-64 sm:w-96 md:w-[600px]`
7. **Login page** — Demo accounts grid: `grid-cols-1 sm:grid-cols-2` on very small screens

### Verification
- [ ] iOS safe area renders correctly
- [ ] All tap targets have visual feedback
- [ ] Loading states look good on mobile
- [ ] Auth page decorative elements don't overflow

---

## Phase 8: Final Verification

### Build & Test
- [ ] `npx next build` — 0 errors
- [ ] `npx next lint` — 0 warnings (if configured)
- [ ] All existing tests pass (if applicable)

### Visual Checks (Manual)
- [ ] 375px (iPhone SE) — all pages fit, no horizontal overflow
- [ ] 390px (iPhone 14) — clean layout
- [ ] 768px (iPad) — 2-column grids, sidebar hidden
- [ ] 1024px (Desktop) — full layout, sidebar visible
- [ ] 1280px+ — spacious layout

### Responsive Patterns Verified
- [ ] No `gray-*` classes in app/ directory
- [ ] All tables have overflow handling
- [ ] All modals fit mobile screens
- [ ] All forms are single-column on mobile
- [ ] All stat grids use `sm:grid-cols-2`
- [ ] Touch targets >= 44px everywhere
- [ ] Dropdowns don't overflow viewport

---

## Execution Notes

- **Parallelizable**: Phases 4, 5, 6 page batches can run with parallel subagents
- **Dependencies**: Phase 1 must complete before Phase 2-3; Phase 2-3 before Phase 4+
- **Risk**: 38 files with `gray-*` migration — use `replace_all` for bulk replacement
- **Estimated files to modify**: ~55 files total
- **Build verification**: Run after each phase
