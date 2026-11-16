//go:build seedsmoke

package userpass

import "os"

// The seed smoke (CI) builds its server with the seedsmoke tag: one demo
// school seed hashes and verifies passwords some 150 times, and with the
// production profile Argon2id took 41 of the server's 67 CPU seconds
// (#7195). The smoke proves the API contracts the seeder drives, not the
// cost of a hash. The profile is encoded into each hash, so verification
// stays correct.
//
// No image is built with this tag (backend/Dockerfile). A binary that
// carries it anyway refuses to start outside APP_ENV=development.
func init() {
	if env := os.Getenv("APP_ENV"); env != "development" {
		panic("binary built with the seedsmoke tag hashes passwords cheaply and runs only under APP_ENV=development, not " + env)
	}
	DefaultOverride = &PasswordParams{
		Memory:      1024, // KiB
		Iterations:  1,
		Parallelism: 1,
		SaltLength:  16,
		KeyLength:   32,
	}
}
