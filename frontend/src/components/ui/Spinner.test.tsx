import React from 'react';
import { render, screen } from '@testing-library/react';
import { Spinner, LoadingScreen, PageLoader } from './Spinner';

describe('Spinner', () => {
  it('renders a spinner element', () => {
    const { container } = render(<Spinner />);
    expect(container.firstChild).toHaveClass('animate-spin');
  });

  it('applies size classes', () => {
    const { container } = render(<Spinner size="lg" />);
    expect(container.firstChild).toHaveClass('h-8', 'w-8');
  });

  it('applies small size classes', () => {
    const { container } = render(<Spinner size="sm" />);
    expect(container.firstChild).toHaveClass('h-4', 'w-4');
  });

  it('applies custom className', () => {
    const { container } = render(<Spinner className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});

describe('LoadingScreen', () => {
  it('renders default loading message', () => {
    render(<LoadingScreen />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<LoadingScreen message="Please wait" />);
    expect(screen.getByText('Please wait')).toBeInTheDocument();
  });
});

describe('PageLoader', () => {
  it('renders default loading message', () => {
    render(<PageLoader />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(<PageLoader message="Loading page..." />);
    expect(screen.getByText('Loading page...')).toBeInTheDocument();
  });
});
