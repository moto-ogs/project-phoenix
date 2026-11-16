package erasureledger

import (
	"path/filepath"
	"syscall"
	"testing"

	"github.com/stretchr/testify/require"
)

// A subprocess forked while the ledger is open holds a copy of its
// descriptor until it execs. The dup stands in for that copy: after the
// operator call returns, the next call must find the ledger unlocked (#7216).
func TestReleaseUnlocksWhileAForkedCopyOfTheDescriptorLives(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "ledger")
	require.NoError(t, Initialize(path))
	// An empty ledger holds no entry whose checksum Check would compute.
	ledger := New(path, func([]byte) string { return "" })

	file, err := ledger.open()
	require.NoError(t, err)
	inherited, err := syscall.Dup(int(file.Fd()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = syscall.Close(inherited) })
	release(file)

	require.NoError(t, ledger.Check(nil, ""), "the forked copy kept the ledger locked")
}
