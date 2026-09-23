import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmployeeImportPage from './page';
import { employeeImportApi } from '@/lib/api-employee-import';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label: _label, ...props }: any) => <input {...props} />,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant: _variant, ...props }: any) => <span {...props}>{children}</span>,
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: (...a: any[]) => mockToast.success(...a), error: (...a: any[]) => mockToast.error(...a) },
}));

jest.mock('@/lib/api-employee-import', () => ({
  employeeImportApi: {
    upload: jest.fn(),
    template: jest.fn(),
  },
}));

const upload = employeeImportApi.upload as jest.Mock;

function selectFile(contents = 'employeeCode\nE1', name = 'employees.csv') {
  const input = screen.getByLabelText('CSV file') as HTMLInputElement;
  const file = new File([contents], name, { type: 'text/csv' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

const cleanPreview = {
  totalRows: 3,
  validRows: 3,
  invalidRows: 0,
  errors: [],
  created: 0,
};

const dirtyPreview = {
  totalRows: 2,
  validRows: 1,
  invalidRows: 1,
  errors: [
    { row: 2, field: 'email', message: '"nope" is not a valid email address' },
    { row: 2, field: 'joinDate', message: '"x" is not a valid date (expected YYYY-MM-DD)' },
  ],
  created: 0,
};

describe('EmployeeImportPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the upload step with the required columns documented', () => {
    render(<EmployeeImportPage />);
    expect(screen.getByRole('heading', { name: /Import employees/i })).toBeInTheDocument();
    expect(screen.getByText(/employeeCode, firstName, lastName, email, joinDate/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview/i })).toBeDisabled();
  });

  it('calls the dry run when Preview is clicked', async () => {
    upload.mockResolvedValue(cleanPreview);
    render(<EmployeeImportPage />);

    const file = selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, { dryRun: true }));
    expect(screen.getByTestId('valid-rows')).toHaveTextContent('Valid: 3');
    expect(screen.getByTestId('invalid-rows')).toHaveTextContent('Invalid: 0');
  });

  it('lists per-row errors after a preview with invalid rows', async () => {
    upload.mockResolvedValue(dirtyPreview);
    render(<EmployeeImportPage />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

    await waitFor(() => expect(screen.getByTestId('invalid-rows')).toHaveTextContent('Invalid: 1'));
    expect(screen.getAllByTestId('error-row-2')).toHaveLength(2);
    expect(screen.getByText('"nope" is not a valid email address')).toBeInTheDocument();
    expect(mockToast.error).toHaveBeenCalledWith('1 of 2 rows need fixing');
  });

  it('keeps the Import button disabled while any row is invalid', async () => {
    upload.mockResolvedValue(dirtyPreview);
    render(<EmployeeImportPage />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Import 1 employees/i })).toBeDisabled());
  });

  it('imports with the initial password and returns to the employee list', async () => {
    upload.mockResolvedValueOnce(cleanPreview).mockResolvedValueOnce({ ...cleanPreview, created: 3 });
    render(<EmployeeImportPage />);

    const file = selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    await waitFor(() => expect(screen.getByTestId('valid-rows')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Initial password'), {
      target: { value: 'initial-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Import 3 employees/i }));

    await waitFor(() =>
      expect(upload).toHaveBeenLastCalledWith(file, {
        dryRun: false,
        initialPassword: 'initial-secret',
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Imported 3 employees');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/employees'));
  });

  it('refuses to import with a short initial password', async () => {
    upload.mockResolvedValue(cleanPreview);
    render(<EmployeeImportPage />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    await waitFor(() => expect(screen.getByTestId('valid-rows')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /Import 3 employees/i }));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Initial password must be at least 8 characters'),
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('shows the server error list when the import is rejected', async () => {
    upload.mockRejectedValue({
      response: { data: { message: 'Import rejected: 1 of 2 rows are invalid', ...dirtyPreview } },
    });
    render(<EmployeeImportPage />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Import rejected: 1 of 2 rows are invalid'),
    );
    expect(screen.getAllByTestId('error-row-2').length).toBeGreaterThan(0);
  });

  it('clears a stale preview when a different file is chosen', async () => {
    upload.mockResolvedValue(cleanPreview);
    render(<EmployeeImportPage />);
    selectFile();
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    await waitFor(() => expect(screen.getByTestId('valid-rows')).toBeInTheDocument());

    selectFile('employeeCode\nE2', 'other.csv');
    expect(screen.queryByTestId('valid-rows')).not.toBeInTheDocument();
  });

  describe('Download template', () => {
    const template = employeeImportApi.template as jest.Mock;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let createObjectURL: jest.Mock;
    let click: jest.SpyInstance;

    const readBlob = (blob: Blob) =>
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(blob);
      });

    beforeEach(() => {
      createObjectURL = jest.fn().mockReturnValue('blob:template');
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = jest.fn();
      click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    });

    // The server owns the column list; a header baked into the page drifts
    // the moment the importer learns a new column.
    it('downloads the header the server serves, not a built-in copy', async () => {
      template.mockResolvedValue('employeeCode,firstName,serverOnlyColumn\n');
      render(<EmployeeImportPage />);

      fireEvent.click(screen.getByRole('button', { name: /Download template/i }));

      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(template).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(await readBlob(blob)).toBe('employeeCode,firstName,serverOnlyColumn\n');
    });

    it('tells the user when the template cannot be fetched', async () => {
      template.mockRejectedValue(new Error('network'));
      render(<EmployeeImportPage />);

      fireEvent.click(screen.getByRole('button', { name: /Download template/i }));

      await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Could not download the template'));
      expect(click).not.toHaveBeenCalled();
    });
  });
});
