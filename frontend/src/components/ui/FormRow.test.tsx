import React from 'react';
import { render, screen } from '@testing-library/react';
import { FormRow, FormGrid, FormActions, FormError, FormSuccess } from './FormRow';

describe('FormRow', () => {
  it('renders children', () => {
    render(<FormRow><input /></FormRow>);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders label', () => {
    render(<FormRow label="Name"><input /></FormRow>);
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('shows required asterisk', () => {
    render(<FormRow label="Name" required><input /></FormRow>);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    const { container } = render(<FormRow><input /></FormRow>);
    expect(container.querySelector('label')).toBeNull();
  });
});

describe('FormGrid', () => {
  it('renders children in grid', () => {
    const { container } = render(
      <FormGrid>
        <div>Col 1</div>
        <div>Col 2</div>
      </FormGrid>
    );
    expect(container.firstChild).toHaveClass('grid');
    expect(screen.getByText('Col 1')).toBeInTheDocument();
    expect(screen.getByText('Col 2')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<FormGrid className="custom"><div /></FormGrid>);
    expect(container.firstChild).toHaveClass('custom');
  });
});

describe('FormActions', () => {
  it('renders children', () => {
    render(<FormActions><button>Save</button></FormActions>);
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('applies flex layout', () => {
    const { container } = render(<FormActions><button>Save</button></FormActions>);
    expect(container.firstChild).toHaveClass('flex');
  });
});

describe('FormError', () => {
  it('renders error message', () => {
    render(<FormError message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders nothing when no message', () => {
    const { container } = render(<FormError />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for empty message', () => {
    const { container } = render(<FormError message="" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('FormSuccess', () => {
  it('renders success message', () => {
    render(<FormSuccess message="Saved successfully" />);
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
  });

  it('renders nothing when no message', () => {
    const { container } = render(<FormSuccess />);
    expect(container.firstChild).toBeNull();
  });
});
