package presenceprojectionhttp

import "time"

var BindTestConfig func(ResourceConfig) ResourceConfig

// testResource binds a unit test's resource like the root does; a test that
// names no clock runs on the wall clock, as it did before the resource
// required one.
func testResource(cfg ResourceConfig) *Resource {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return NewResource(BindTestConfig(cfg))
}
