// Package daychangesview is the public capability of the read projection
// "Heute anders" (ADR 0299): every change to regular operation of the
// session's school on its calendar day, for the staff portal. It reads each
// source through a consumer-owned port the root binds to the owning module,
// applies no permission rule of its own, persists nothing and never writes.
package daychangesview
