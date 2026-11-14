// LD_PRELOAD shim for the PostgreSQL server of scripts/fake-clock-postgres.sh
// (#4027). It adds the seconds in the file named by PHX_FAKE_CLOCK_FILE to
// the wall clock (CLOCK_REALTIME, gettimeofday, time) and touches nothing
// else: monotonic clocks, sleeps and waits stay real. libfaketime was tried
// first; it reads the real time while a process waits in an intercepted
// epoll_wait, so a timeout signal arriving there saw a time an offset earlier
// and PostgreSQL rearmed the timer instead of cancelling (statement_timeout
// and lock_timeout fired an offset late). The file is reread at most once a
// second, so one server serves several times in a row.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdlib.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static int (*real_clock_gettime)(clockid_t, struct timespec *);
static long long offset_seconds;
static time_t checked_at = -1;

static void refresh_offset(void) {
	struct timespec now;
	if (!real_clock_gettime) {
		real_clock_gettime = (int (*)(clockid_t, struct timespec *))dlsym(RTLD_NEXT, "clock_gettime");
	}
	if (real_clock_gettime(CLOCK_MONOTONIC, &now) != 0 || now.tv_sec == checked_at) {
		return;
	}
	checked_at = now.tv_sec;
	const char *path = getenv("PHX_FAKE_CLOCK_FILE");
	if (!path) {
		return;
	}
	int fd = open(path, O_RDONLY | O_CLOEXEC);
	if (fd < 0) {
		return;
	}
	char text[32];
	ssize_t length = read(fd, text, sizeof text - 1);
	close(fd);
	if (length > 0) {
		text[length] = '\0';
		offset_seconds = strtoll(text, NULL, 10);
	}
}

int clock_gettime(clockid_t clock, struct timespec *value) {
	refresh_offset();
	int result = real_clock_gettime(clock, value);
	if (result == 0 && (clock == CLOCK_REALTIME || clock == CLOCK_REALTIME_COARSE)) {
		value->tv_sec += offset_seconds;
	}
	return result;
}

int gettimeofday(struct timeval *restrict value, void *restrict zone) {
	(void)zone;
	struct timespec now;
	int result = clock_gettime(CLOCK_REALTIME, &now);
	if (result == 0 && value) {
		value->tv_sec = now.tv_sec;
		value->tv_usec = now.tv_nsec / 1000;
	}
	return result;
}

time_t time(time_t *value) {
	struct timespec now;
	if (clock_gettime(CLOCK_REALTIME, &now) != 0) {
		return (time_t)-1;
	}
	if (value) {
		*value = now.tv_sec;
	}
	return now.tv_sec;
}
