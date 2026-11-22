package enrollmenthttp

import (
	"net/http"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
)

// markTraegerBueroReviewer marks the request of a school session the
// Träger-Büro opened through the Absprung, so that an approval by a person
// without a staff record writes its weekly rows as the Träger-Büro (#7818).
// The token's via_traeger is minted and re-checked by Identity & Access only
// for a person with the Träger right "In OGS wechseln"; the routes keep their
// own permission checks.
func markTraegerBueroReviewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sessiontoken.ClaimsFromCtx(r.Context()).ViaTraeger {
			r = r.WithContext(capability.WithTraegerBueroReviewer(r.Context()))
		}
		next.ServeHTTP(w, r)
	})
}
