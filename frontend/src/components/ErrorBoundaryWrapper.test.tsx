import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundaryWrapper } from './ErrorBoundaryWrapper';

// Suppress console.error for error boundary tests
const originalError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalError;
});

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>No error</div>;
}

describe('ErrorBoundaryWrapper', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundaryWrapper>
        <div>Content</div>
      </ErrorBoundaryWrapper>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders error fallback when child throws', () => {
    render(
      <ErrorBoundaryWrapper>
        <ThrowError shouldThrow={true} />
      </ErrorBoundaryWrapper>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('renders try again button', () => {
    render(
      <ErrorBoundaryWrapper>
        <ThrowError shouldThrow={true} />
      </ErrorBoundaryWrapper>
    );
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});
