import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('renders input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Input label="Email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    const { container } = render(<Input />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('renders error message', () => {
    render(<Input error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
  });

  it('applies error class when error is present', () => {
    render(<Input error="Error" />);
    expect(screen.getByRole('textbox').className).toContain('border-red-500');
  });

  it('passes placeholder prop', () => {
    render(<Input placeholder="Enter email" />);
    expect(screen.getByPlaceholderText('Enter email')).toBeInTheDocument();
  });

  it('handles value and onChange', () => {
    const handleChange = jest.fn();
    render(<Input value="test" onChange={handleChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('can be disabled', () => {
    render(<Input disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('applies custom className', () => {
    render(<Input className="custom" />);
    expect(screen.getByRole('textbox').className).toContain('custom');
  });

  it('ties the label to the input so clicking it focuses the field', () => {
    // Without htmlFor the label is decoration: a screen reader announces the
    // input as unlabelled, and clicking the text does nothing.
    render(<Input label="Section 80C" />);

    const field = screen.getByLabelText('Section 80C');
    expect(field.tagName).toBe('INPUT');
  });

  it('gives two fields sharing a label distinct ids', () => {
    // A label slug alone would collide, and a duplicate id silently points both
    // labels at the first field.
    render(
      <>
        <Input label="Amount" />
        <Input label="Amount" />
      </>,
    );

    const [first, second] = screen.getAllByLabelText('Amount');
    expect(first.id).not.toBe(second.id);
  });

  it('keeps an id the caller supplied', () => {
    render(<Input label="TDS" id="tds-field" />);

    expect(screen.getByLabelText('TDS')).toHaveAttribute('id', 'tds-field');
  });
});
