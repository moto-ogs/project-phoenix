// Database Entity Configuration Types

import type { Pagination } from "~/lib/contract/runtime";
import type { MotoConcept } from "~/lib/moto-concepts";

// Field types supported by the database forms
type FieldType =
  | "text"
  | "email"
  | "password"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "custom"
  | "number"
  | "date";

// Base field configuration - extends the form field type
interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  validation?: (value: unknown) => string | null;
  // For select/multiselect fields - supports both sync and async options
  options?:
    | Array<{ value: string; label: string }>
    | (() => Promise<Array<{ value: string; label: string }>>);
  /** Cache name of the response an `options` function reads (DatabaseForm). */
  optionsResource?: string;
  // For custom fields
  component?: React.ComponentType<{
    value: unknown;
    onChange: (value: unknown) => void;
    label: string;
    required?: boolean;
    includeEmpty?: boolean;
    emptyLabel?: string;
  }>;
  /**
   * Extra props merged into `component` before the form's own props. Keeps a
   * shared custom field reusable with different presets (e.g. a per-room
   * default colour) without wrapping it in a second component.
   */
  componentProps?: Record<string, unknown>;
  // Grid layout
  colSpan?: 1 | 2;
  autoComplete?: string;
  // For number fields
  min?: number;
  max?: number;
  // For text/email/textarea fields
  maxLength?: number;
}

// Form field type (imported from database-form.tsx)
interface FormField {
  name: string;
  label: string;
  type:
    | "text"
    | "email"
    | "select"
    | "multiselect"
    | "textarea"
    | "password"
    | "checkbox"
    | "custom"
    | "number"
    | "date";
  required?: boolean;
  placeholder?: string;
  options?:
    | Array<{ value: string; label: string }>
    | (() => Promise<Array<{ value: string; label: string }>>);
  validation?: (value: unknown) => string | null;
  component?: React.ComponentType<{
    value: unknown;
    onChange: (value: unknown) => void;
    label: string;
    required?: boolean;
    includeEmpty?: boolean;
    emptyLabel?: string;
  }>;
  /**
   * Extra props merged into `component` before the form's own props. Keeps a
   * shared custom field reusable with different presets (e.g. a per-room
   * default colour) without wrapping it in a second component.
   */
  componentProps?: Record<string, unknown>;
  helperText?: string;
  autoComplete?: string;
  colSpan?: 1 | 2;
  min?: number;
  max?: number;
  maxLength?: number;
  /** When true, the field is rendered as read-only and cannot be edited. */
  disabled?: boolean;
}

// Form section type (imported from database-form.tsx)
interface FormSection {
  title: string;
  subtitle?: string;
  fields: FormField[];
  columns?: 1 | 2;
  /** Optional concept driving the section's header icon (gray tile, MotoConceptIcon). */
  concept?: MotoConcept;
}

// Section configuration for forms
export interface SectionConfig {
  title: string;
  subtitle?: string;
  fields: FieldConfig[];
  columns?: 1 | 2;
  /** Optional concept driving the section's header icon (gray tile, MotoConceptIcon). */
  concept?: MotoConcept;
}

/**
 * The calls of an entity (#7806). Each calls `bffJson` with its registered
 * route and maps the generated answer, so the compiler checks path
 * parameters, query, body and answer against the contract.
 */
export interface EntityApi<T> {
  /** Every record; a paginated route also answers its page. */
  list?: () => Promise<T[] | PaginatedResponse<T>>;
  get?: (id: string) => Promise<T>;
  create?: (data: Partial<T>) => Promise<T>;
  /**
   * `current` is the loaded record, for a call that needs unchanged fields.
   * Resolves to null when the route answers without the record.
   */
  update?: (id: string, data: Partial<T>, current?: T) => Promise<T | null>;
  delete?: (id: string) => Promise<unknown>;
}

export interface EntityConfig<T> {
  name: {
    singular: string;
    plural: string;
  };
  api: EntityApi<T>;
}

export interface EntityFormConfig<T> {
  createTitle: string;
  form: {
    sections: SectionConfig[];
    transformBeforeSubmit?: (data: Partial<T>) => Partial<T>;
    defaultValues?: Partial<T>;
  };
}

// Utility to convert SectionConfig to FormSection
export function configToFormSection(section: SectionConfig): FormSection {
  return {
    title: section.title,
    subtitle: section.subtitle,
    fields: section.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      placeholder: field.placeholder,
      options: field.options,
      optionsResource: field.optionsResource,
      validation: field.validation,
      component: field.component,
      componentProps: field.componentProps,
      helperText: field.helperText,
      autoComplete: field.autoComplete,
      colSpan: field.colSpan,
      min: field.min,
      max: field.max,
      maxLength: field.maxLength,
    })),
    columns: section.columns,
    concept: section.concept,
  };
}

// Response types for pagination
export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// Generic CRUD service interface
export interface CrudService<T> {
  getList(): Promise<PaginatedResponse<T>>;
  getOne(id: string): Promise<T>;
  create(data: Partial<T>): Promise<T>;
  /**
   * Pass the loaded record when the update needs unchanged fields. Resolves
   * to null when the route answers without the record.
   */
  update(id: string, data: Partial<T>, current?: T): Promise<T | null>;
  /** Throws the route's `ApiError` on refusal. */
  remove(id: string): Promise<void>;
}
