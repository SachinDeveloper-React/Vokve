import React from 'react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Checkbox } from './Checkbox';
import { DateField } from './DateField';
import { FeetInchesField } from './FeetInchesField';
import { Input, type InputProps } from './Input';
import { MeasureField } from './MeasureField';
import { PhoneInput, type PhoneValue } from './PhoneInput';
import { RadioGroup, type RadioOption } from './Radio';
import { SegmentedControl, type Segment } from './SegmentedControl';
import { Select, type SelectOption } from './Select';
import { Switch } from './Switch';
import { TextArea } from './TextArea';

/**
 * react-hook-form bindings for the form controls.
 *
 * The plain controls stay presentational — value in, onChange out — and these
 * wrappers connect them. Keeping the two apart means a control can be used in
 * a screen that has no form (a settings toggle backed by a zustand store, for
 * instance) without dragging react-hook-form in with it.
 */
interface FieldBase<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> {
  control: Control<TValues>;
  name: TName;
}

export function FormInput<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  ...props
}: FieldBase<TValues, TName> & Omit<InputProps, 'value' | 'onChangeText' | 'error'>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <Input
      value={(field.value as string | undefined) ?? ''}
      onChangeText={field.onChange}
      onBlur={field.onBlur}
      // The message is shown only once the field has been touched or the form
      // submitted; RHF's default mode already handles that, so passing the
      // error straight through does not shout at someone mid-typing.
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormTextArea<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  ...props
}: FieldBase<TValues, TName> &
  Omit<React.ComponentProps<typeof TextArea>, 'value' | 'onChangeText' | 'error'>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <TextArea
      value={(field.value as string | undefined) ?? ''}
      onChangeText={field.onChange}
      onBlur={field.onBlur}
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormFeetInchesField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  ...props
}: FieldBase<TValues, TName> &
  Omit<
    React.ComponentProps<typeof FeetInchesField>,
    'value' | 'onChange' | 'error'
  >) {
  const { field, fieldState } = useController({ control, name });

  return (
    <FeetInchesField
      value={(field.value as number | null | undefined) ?? null}
      onChange={field.onChange}
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormMeasureField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  ...props
}: FieldBase<TValues, TName> &
  Omit<
    React.ComponentProps<typeof MeasureField>,
    'value' | 'onChange' | 'error'
  >) {
  const { field, fieldState } = useController({ control, name });

  return (
    <MeasureField
      value={(field.value as number | null | undefined) ?? null}
      onChange={field.onChange}
      onBlur={field.onBlur}
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormPhoneInput<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  ...props
}: FieldBase<TValues, TName> &
  Omit<React.ComponentProps<typeof PhoneInput>, 'value' | 'onChange' | 'error'>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <PhoneInput
      value={field.value as PhoneValue}
      onChange={field.onChange}
      onBlur={field.onBlur}
      // The country half of the value cannot be empty, so only the number can
      // fail — which is why the message reads as one field's, not two.
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormDateField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  ...props
}: FieldBase<TValues, TName> &
  Omit<React.ComponentProps<typeof DateField>, 'value' | 'onChange' | 'error'>) {
  const { field, fieldState } = useController({ control, name });

  return (
    <DateField
      value={(field.value as string | undefined) ?? null}
      onChange={field.onChange}
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormSegmentedControl<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TOption extends string,
>({
  control,
  name,
  segments,
  ...props
}: FieldBase<TValues, TName> & {
  segments: Segment<TOption>[];
  label?: string;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { field, fieldState } = useController({ control, name });

  return (
    <SegmentedControl
      segments={segments}
      value={(field.value as TOption | undefined) ?? null}
      onChange={field.onChange}
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormCheckbox<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  label,
  labelSlot,
  helper,
  disabled,
  tone,
}: FieldBase<TValues, TName> & {
  label?: string;
  labelSlot?: React.ReactNode;
  helper?: string;
  disabled?: boolean;
  tone?: 'primary' | 'brand';
}) {
  const { field, fieldState } = useController({ control, name });

  return (
    <Checkbox
      checked={Boolean(field.value)}
      onChange={field.onChange}
      label={label}
      labelSlot={labelSlot}
      helper={fieldState.error?.message ?? helper}
      error={Boolean(fieldState.error)}
      disabled={disabled}
      tone={tone}
    />
  );
}

export function FormSwitch<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
>({
  control,
  name,
  label,
  helper,
  disabled,
}: FieldBase<TValues, TName> & {
  label?: string;
  helper?: string;
  disabled?: boolean;
}) {
  const { field } = useController({ control, name });

  return (
    <Switch
      value={Boolean(field.value)}
      onChange={field.onChange}
      label={label}
      helper={helper}
      disabled={disabled}
    />
  );
}

export function FormRadioGroup<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TOption extends string,
>({
  control,
  name,
  options,
  ...props
}: FieldBase<TValues, TName> & {
  options: RadioOption<TOption>[];
  label?: string;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { field, fieldState } = useController({ control, name });

  return (
    <RadioGroup
      options={options}
      value={(field.value as TOption | undefined) ?? null}
      onChange={field.onChange}
      error={fieldState.error?.message}
      {...props}
    />
  );
}

export function FormSelect<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TOption extends string,
>({
  control,
  name,
  options,
  ...props
}: FieldBase<TValues, TName> & {
  options: SelectOption<TOption>[];
  label?: string;
  helper?: string;
  placeholder?: string;
  sheetTitle?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { field, fieldState } = useController({ control, name });

  return (
    <Select
      options={options}
      value={(field.value as TOption | undefined) ?? null}
      onChange={field.onChange}
      error={fieldState.error?.message}
      {...props}
    />
  );
}
