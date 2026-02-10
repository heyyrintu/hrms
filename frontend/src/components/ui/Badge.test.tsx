import React from 'react';
import { render, screen } from '@testing-library/react';
import { Badge, getStatusBadgeVariant } from './Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders as span element', () => {
    render(<Badge>Test</Badge>);
    expect(screen.getByText('Test').tagName).toBe('SPAN');
  });

  it('applies default variant classes', () => {
    render(<Badge>Default</Badge>);
    const el = screen.getByText('Default');
    expect(el.className).toContain('bg-primary-50');
    expect(el.className).toContain('text-primary-700');
  });

  it('applies success variant classes', () => {
    render(<Badge variant="success">Success</Badge>);
    const el = screen.getByText('Success');
    expect(el.className).toContain('bg-emerald-50');
    expect(el.className).toContain('text-emerald-700');
  });

  it('applies warning variant classes', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const el = screen.getByText('Warning');
    expect(el.className).toContain('bg-amber-50');
    expect(el.className).toContain('text-amber-700');
  });

  it('applies danger variant classes', () => {
    render(<Badge variant="danger">Danger</Badge>);
    const el = screen.getByText('Danger');
    expect(el.className).toContain('bg-red-50');
    expect(el.className).toContain('text-red-700');
  });

  it('applies info variant classes', () => {
    render(<Badge variant="info">Info</Badge>);
    const el = screen.getByText('Info');
    expect(el.className).toContain('bg-sky-50');
    expect(el.className).toContain('text-sky-700');
  });

  it('applies gray variant classes', () => {
    render(<Badge variant="gray">Gray</Badge>);
    const el = screen.getByText('Gray');
    expect(el.className).toContain('bg-warm-100');
    expect(el.className).toContain('text-warm-600');
  });

  it('applies custom className', () => {
    render(<Badge className="custom">Test</Badge>);
    expect(screen.getByText('Test').className).toContain('custom');
  });
});

describe('getStatusBadgeVariant', () => {
  it('returns success for present', () => {
    expect(getStatusBadgeVariant('present')).toBe('success');
  });

  it('returns success for approved', () => {
    expect(getStatusBadgeVariant('APPROVED')).toBe('success');
  });

  it('returns warning for pending', () => {
    expect(getStatusBadgeVariant('PENDING')).toBe('warning');
  });

  it('returns danger for absent', () => {
    expect(getStatusBadgeVariant('absent')).toBe('danger');
  });

  it('returns info for leave', () => {
    expect(getStatusBadgeVariant('leave')).toBe('info');
  });

  it('returns gray for unknown', () => {
    expect(getStatusBadgeVariant('UNKNOWN')).toBe('gray');
  });
});
