package architecture

import "go/types"

const calendarPackagePath = "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

// effectFreeClock reports whether a callable is an injected clock: no
// parameters and one result, an instant (time.Time) or a calendar day
// (calendar.Date). A clock reads the time and writes nothing, so calling it
// is no command effect, whatever closure the root binds (ADR 0098 addendum,
// #4027). Without this every clock a composition passes through, as Rule 14
// asks, surfaced as an unresolved binding that needed an approval ADR.
func effectFreeClock(callable types.Type) bool {
	signature, ok := callable.Underlying().(*types.Signature)
	if !ok || signature.Params().Len() != 0 || signature.Results().Len() != 1 {
		return false
	}
	named, ok := types.Unalias(signature.Results().At(0).Type()).(*types.Named)
	if !ok || named.Obj().Pkg() == nil {
		return false
	}
	switch named.Obj().Pkg().Path() + "." + named.Obj().Name() {
	case "time.Time", calendarPackagePath + ".Date":
		return true
	}
	return false
}
