// Tagesinformationen in moto schule (#2208): dieselben Hinweise der
// OGS-Leitung wie im OGS-Portal, gelesen über die school-Session und die
// Proxy-Routen unter /api/school/staff-notices (Backend:
// /school/staff-notices). Das Backend liefert nur, was "alle" oder "nur
// Lehrkräfte" erreicht.

import { createStaffNoticesReadApi } from "./staff-notices-api";

export const schoolStaffNoticesApi = createStaffNoticesReadApi(
  "/api/school/staff-notices",
);
