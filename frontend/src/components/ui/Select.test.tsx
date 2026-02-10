import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B' },
    { value: 'c', label: 'Option C' },
  ];

  it('renders a select element', () => {
    render(<Select options={options} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders options', () => {
    render(<Select options={options} />);
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getByText('Option C')).toBeInTheDocument();
  });

  it('renders placeholder', () => {
    render(<Select options={options} placeholder="Select one" />);
    expect(screen.getByText('Select one')).toBeInTheDocument();
  });

  it('renders label', () => {
    render(<Select label="Department" options={options} />);
    expect(screen.getByText('Department')).toBeInTheDocument();
  });

  it('renders error message', () => {
    render(<Select options={options} error="Required" />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('applies error styling', () => {
    render(<Select options={options} error="Required" />);
    expect(screen.getByRole('combobox').className).toContain('border-red-400');
  });

  it('handles onChange', () => {
    const handleChange = jest.fn();
    render(<Select options={options} onChange={handleChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('renders children instead of options when provided', () => {
    render(
      <Select>
        <option value="custom">Custom Option</option>
      </Select>
    );
    expect(screen.getByText('Custom Option')).toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<Select options={options} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
