package collation

// UnaccentLikePatternSQL is the SQL expression for a LIKE pattern of the
// search text bound to its ?: folded by public.f_unaccent, the database twin
// of FoldForSearch, then with its LIKE metacharacters escaped for ESCAPE '\'.
// The order matters: unaccent turns fullwidth ％, ＿ and ＼ into %, _ and \,
// so escaping first would let "％" match every name (#5791). Wrap it in
// '%' || … || '%' for a substring search.
const UnaccentLikePatternSQL = `replace(replace(replace(public.f_unaccent(?), '\', '\\'), '%', '\%'), '_', '\_')`

// RedactLiteralsInLog opens a statement whose string literals carry what a
// person typed, such as a search text bound through UnaccentLikePatternSQL
// (ADR 0231 point 5, ADR 0234). bun writes bound values into the SQL it hands
// to the query log, so the log replaces every string literal of a statement
// that starts with this marker before it writes the statement. The marker is
// an SQL comment: Postgres ignores it. Transaction Runtime's query log reads
// it as protocol.RedactLiteralsInLog; it lives here so every owner that runs
// a search statement can mark it.
const RedactLiteralsInLog = "/* moto:redact-literals */ "
