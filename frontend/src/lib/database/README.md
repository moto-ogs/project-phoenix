# Database Component Architecture

This directory contains shared form configuration and service helpers for database management pages.

## Overview

Entity pages use a shared configuration object and service factory, then compose the page-specific list, detail, modal, and layout components they need.

## Architecture

### 1. Entity Configuration (`configs/`)

Entity configs contain the API calls used by the page and, when the page
uses `DatabaseFormModal`, the create title, sections and defaults:

- API calls: each calls `bffJson` with its registered route, so path
  parameters, body and answer are checked against the generated contract
- Form fields and sections, including validation and option loaders

Example: `configs/rooms.config.tsx`

### 2. Shared Components

- **DatabaseForm**: Renders forms based on configuration
- **DatabaseFormModal**: Wraps configured forms in creation modals
- **DatabasePageLayout**: Provides loading and page shell behavior
- **DatabaseEmptyState**, **DatabaseCreateAction**, and related helpers: Shared page controls

### 3. Service Factory

The `service-factory.ts` wraps the config's calls in a CRUD service with logging;
it does not call `bffJson` itself:

- getList (an unpaginated list becomes one page)
- getOne
- create
- update
- remove (throws the ApiError)

## Usage Example

### 1. Create Entity Configuration

```typescript
// configs/rooms.config.tsx
export const roomsConfig = {
  name: {
    singular: "Raum",
    plural: "Räume",
  },

  api: {
    create: async (data) =>
      mapRoomResponse(
        await bffJson("tenant", "POST /api/rooms/", {
          body: prepareRoomForBackend(data),
        }),
      ),
  },

  form: {
    sections: [
      {
        title: "Raumdetails",
        fields: [
          {
            name: "name",
            label: "Raumname",
            type: "text",
            required: true,
          },
          // ... more fields
        ],
      },
    ],
  },

  createTitle: "Neuer Raum",
} satisfies EntityConfig<Room> & EntityFormConfig<Room>;
```

### 2. Use the Configuration in a Page

```typescript
// app/database/rooms/page.tsx
"use client";

import { useMemo, useState } from "react";
import { DatabasePageLayout } from "~/components/database/database-page-layout";
import { DatabaseFormModal } from "~/components/database/database-form-modal";
import { RoomsList } from "@/components/rooms/rooms-list";
import { roomsConfig } from "@/components/database/configs/rooms.config";
import { createCrudService } from "@/lib/database/service-factory";
import { useApiFormError } from "~/contexts/ToastContext";
import { useTenantAwarePath } from "~/lib/tenant-path";

export default function RoomsPage() {
  const service = useMemo(() => createCrudService(roomsConfig), []);
  const tenantPath = useTenantAwarePath();
  const [showCreateModal, setShowCreateModal] = useState(false);
  // The kit may not import contexts: the owner hands in the error path.
  const createErrors = useApiFormError();

  return (
    <DatabasePageLayout loading={loading} sessionLoading={sessionLoading}>
      {/* Render the page's own list and controls.
          Every row links to the type's object route (BAUARTEN-SPEC Bauart 1
          Regel 2); `?from=` carries the way back to this register. Editing
          and deleting live on that route, not next to the list. */}
      <RoomsList
        groupDefinitions={groupDefinitions}
        objectHref={(room) =>
          tenantPath(`/rooms/${room.id}?from=${encodeURIComponent("/database/rooms")}`)
        }
      />
      <DatabaseFormModal<Room>
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        config={roomsConfig}
        onSubmit={handleCreateRoom}
        errorPath={createErrors}
        errorObject="das Speichern des Raums"
      />
    </DatabasePageLayout>
  );
}
```

`DatabaseFormModal` renders the config's `form.sections` with its `createTitle`.
Editing uses `DatabaseForm` on the object or detail page.

`errorPath` is required on `DatabaseForm` and `DatabaseFormModal` (#2517):
`onSubmit` lets the error propagate, and the form shows the catalog text with
retry, marks named fields and runs its own checks through `invalid()`. A
failed `options()` loader of a select field throws its `ApiError` too; the
form names the choice and offers a retry instead of an empty select. Deleting
goes through `service.remove(id)`, which throws the `ApiError`; show it in
the open `ConfirmDeleteModal` via a second `useApiFormError`.

The configuration and service factory provide the shared CRUD behavior. Each page still owns its own data loading, selection state, filters, and entity-specific UI:

- List view with search and filters
- Create modal with form validation
- Detail view with edit/delete actions
- Responsive design
- Error handling
- Loading states

## Configuration Reference

### Field Types

- `text`: Standard text input
- `email`: Email input with validation
- `password`: Password input
- `textarea`: Multi-line text
- `select`: Dropdown with options
- `checkbox`: Boolean checkbox
- `custom`: Custom field component

### Concepts

Page and form-section headers take their icon and tone from `lib/concepts/`.
Import the relevant definition directly (for example, `roomsConcept` from
`~/lib/concepts/rooms`), not the `MOTO_CONCEPTS` registry.

The former `lib/database/themes.tsx` and its `databaseThemes` export are gone;
adding a new entity means picking an existing concept module or adding one
under `lib/concepts/` (plus its `MOTO_CONCEPTS` entry), not defining a new color
pair.

## Migration Guide

To migrate an existing page:

1. Analyze the existing page structure
2. Create entity configuration matching the fields and layout
3. Create a CRUD service with `createCrudService(config)`
4. Render the page with `DatabasePageLayout` and the entity-specific list, detail, and modal components
5. Test thoroughly
6. Remove old components once verified

## Benefits

- **Consistency**: All pages follow the same UX patterns
- **Maintainability**: Changes to common behavior update everywhere
- **Speed**: New entities can be added in minutes
- **Type Safety**: Full TypeScript support
- **Customization**: Override any part when needed

## Future Enhancements

- Field dependencies (show/hide based on other fields)
- Bulk operations
- Import/Export functionality
- Advanced filtering UI
- Inline editing in list view
