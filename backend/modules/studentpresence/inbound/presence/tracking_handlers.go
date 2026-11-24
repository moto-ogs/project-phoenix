package presence

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// getTrackingIndicators handles POST /tracking-indicators
// Returns per-student match results for configured tracking indicator labels.
func (rs *Resource) getTrackingIndicators(w http.ResponseWriter, r *http.Request) {
	var req TrackingIndicatorsRequest
	if err := wire.Decode(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return
	}

	if len(req.StudentIDs) == 0 {
		common.Respond(w, r, http.StatusOK, TrackingIndicatorsResponse{
			Labels:  []string{},
			Results: map[int64][]bool{},
		}, "")
		return
	}

	for _, id := range req.StudentIDs {
		if id <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid student ID")))
			return
		}
	}

	ctx, labels, err := rs.displaySettings.TrackingIndicatorLabels(r.Context())
	if err != nil {
		rs.getLogger().Warn("tracking_indicators_settings_error",
			"error", err.Error(),
		)
		common.Respond(w, r, http.StatusOK, TrackingIndicatorsResponse{
			Labels:  []string{},
			Results: map[int64][]bool{},
		}, "")
		return
	}

	if len(labels) == 0 {
		common.Respond(w, r, http.StatusOK, TrackingIndicatorsResponse{
			Labels:  []string{},
			Results: map[int64][]bool{},
		}, "")
		return
	}

	// Get tracking indicator results from the service.
	results, err := rs.Operations.GetTrackingIndicators(ctx, ident.Int64s(req.StudentIDs), labels)
	if err != nil {
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, TrackingIndicatorsResponse{
		Labels:  labels,
		Results: results,
	}, "")
}
