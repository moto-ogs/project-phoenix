package protocol

import "github.com/moto-ogs/project-phoenix/sharedkernel/collation"

// RedactLiteralsInLog opens a statement whose string literals carry what a
// person typed, such as the text of a search (ADR 0231). bun writes bound
// values into the SQL it hands to the query log, so the log replaces every
// string literal of a statement that starts with this marker before it
// writes the statement. The marker is an SQL comment: Postgres ignores it.
// It is the shared kernel's collation.RedactLiteralsInLog (ADR 0234), so an
// owner without a reach into this runtime marks its statements the same way.
const RedactLiteralsInLog = collation.RedactLiteralsInLog
