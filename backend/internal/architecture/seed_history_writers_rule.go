package architecture

// seedHistoryWriterPackages are the owner compositions ADR 0298 lets the dev
// CLI bind for the seed's writes that no client route makes: the past
// ratings, the seeded school vacations and the two counts of the billing
// snapshot. Each grant names exactly one composition package.
var seedHistoryWriterPackages = map[string]string{
	"feedback":          "modules/feedback/compose",
	"school-calendar":   "modules/schoolcalendar/compose",
	"school-membership": "modules/schoolmembership/compose",
	"device-fleet":      "modules/devicefleet/compose",
}

// reviewedSeedHistoryWritersRule pins ADR 0298's CLI wiring to those single
// composition packages, without granting access to their persistence.
func reviewedSeedHistoryWritersRule(rule Rule) bool {
	target, ok := seedHistoryWriterPackages[rule.TargetOwner]
	return ok && rule.SourceOwner == "dev-tools" && rule.SourceOwnerKind == "" && rule.SourceRole == "compose" && rule.SourcePackage == "" &&
		rule.TargetOwnerKind == "" && rule.TargetRole == "compose" && rule.TargetPackage == target &&
		rule.TargetClass == "" && !rule.SameOwner && len(rule.Scopes) == 1 && rule.Scopes[0] == string(ScopeProduction)
}
