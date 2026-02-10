import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  TableLoadingState,
} from './Table';

describe('Table', () => {
  it('renders a table', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>John</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });
});

describe('TableRow', () => {
  it('renders children', () => {
    render(
      <table>
        <tbody>
          <TableRow>
            <td>Content</td>
          </TableRow>
        </tbody>
      </table>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('handles onClick', () => {
    const handleClick = jest.fn();
    render(
      <table>
        <tbody>
          <TableRow onClick={handleClick}>
            <td>Clickable</td>
          </TableRow>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByText('Clickable').closest('tr')!);
    expect(handleClick).toHaveBeenCalled();
  });
});

describe('TableHead', () => {
  it('renders without children', () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <TableHead />
          </tr>
        </thead>
      </table>
    );
    expect(container.querySelector('th')).toBeInTheDocument();
  });

  it('renders with children', () => {
    render(
      <table>
        <thead>
          <tr>
            <TableHead>Header</TableHead>
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
  });
});

describe('TableEmptyState', () => {
  it('renders default message', () => {
    render(
      <table>
        <tbody>
          <TableEmptyState />
        </tbody>
      </table>
    );
    expect(screen.getByText('No data found')).toBeInTheDocument();
  });

  it('renders custom message', () => {
    render(
      <table>
        <tbody>
          <TableEmptyState message="No employees" />
        </tbody>
      </table>
    );
    expect(screen.getByText('No employees')).toBeInTheDocument();
  });
});

describe('TableLoadingState', () => {
  it('renders loading text', () => {
    render(
      <table>
        <tbody>
          <TableLoadingState />
        </tbody>
      </table>
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
