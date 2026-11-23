package api

import (
	"fmt"
)

// mealPlanVersions reads the version of every weekday of the week of day: a
// save of a day sends its version back (ADR 0311).
func mealPlanVersions(rt *Runtime, day seedDate) (map[string]string, error) {
	raw, err := rt.Client.Get("/api/meal-plan/days?week_start=" + day.String())
	if err != nil {
		return nil, fmt.Errorf("read the meal plan of the week of %s: %w", day, err)
	}
	var response struct {
		Data []struct {
			Date    string `json:"date"`
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &response); err != nil {
		return nil, fmt.Errorf("parse the meal plan of the week of %s: %w", day, err)
	}
	versions := make(map[string]string, len(response.Data))
	for _, read := range response.Data {
		versions[read.Date] = read.Version
	}
	return versions, nil
}

// saveMealPlanDay replaces the dishes of a day against the version read
// before.
func saveMealPlanDay(rt *Runtime, day string, version string, dishes any) error {
	_, err := rt.Client.Put("/api/meal-plan/days/"+day, map[string]any{"dishes": dishes, "expected_version": version})
	return err
}

// replaceMealDays reads a day's version and replaces its dishes.
func replaceMealDays(rt *Runtime, day seedDate, dishes any) error {
	versions, err := mealPlanVersions(rt, day)
	if err != nil {
		return err
	}
	return saveMealPlanDay(rt, day.String(), versions[day.String()], dishes)
}

// mealScheduleVersion reads the version of a child's regular lunch days
// through get, from the staff route or the parents' one: a change of them
// sends it back (ADR 0311). Any one day reads them all.
func mealScheduleVersion(get func(string) ([]byte, error), path string, day seedDate) (string, error) {
	raw, err := get(fmt.Sprintf("%s?from=%s&to=%s", path, day, day))
	if err != nil {
		return "", fmt.Errorf("read the regular lunch days at %s: %w", path, err)
	}
	var response struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &response); err != nil {
		return "", fmt.Errorf("parse the regular lunch days at %s: %w", path, err)
	}
	return response.Data.Version, nil
}

// schoolMealSchedule replaces a child's regular lunch days for the school,
// from day on, against the version read before.
func schoolMealSchedule(rt *Runtime, auth *AuthRef, studentID int64, weekdays []int, day seedDate) error {
	get, put := rt.Client.Get, rt.Client.Put
	if auth != nil {
		get = func(path string) ([]byte, error) { return rt.Client.GetWithAuth(*auth, path) }
		put = func(path string, body any) ([]byte, error) { return rt.Client.PutWithAuth(*auth, path, body) }
	}
	path := fmt.Sprintf("/api/meal-plan/participation/%d", studentID)
	version, err := mealScheduleVersion(get, path, day)
	if err != nil {
		return err
	}
	_, err = put(path+"/schedule", map[string]any{"weekdays": weekdays, "effective_from": day.String(), "expected_version": version})
	return err
}

// parentMealSchedule replaces a child's regular lunch days for a parent
// against the version read before.
func parentMealSchedule(rt *Runtime, auth AuthRef, studentID int64, weekdays []int) ([]byte, error) {
	path := fmt.Sprintf("/parent/me/children/%d/meal-participation", studentID)
	get := func(path string) ([]byte, error) { return rt.Client.GetWithAuth(auth, path) }
	version, err := mealScheduleVersion(get, path, todaySeedDate())
	if err != nil {
		return nil, err
	}
	return rt.Client.PutWithAuth(auth, path, map[string]any{"weekdays": weekdays, "expected_version": version})
}
