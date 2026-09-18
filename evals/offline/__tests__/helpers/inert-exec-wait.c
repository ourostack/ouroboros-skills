#define _GNU_SOURCE
#include <stdio.h>

#ifdef __linux__
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

enum { WORK_MS = 5000, CLEANUP_MS = 5000 };
static volatile sig_atomic_t cancelled;

struct context {
  unsigned uid[4], gid[4];
  long tracer;
  char user_namespace[128], uid_map[4096];
};

struct probe {
  pid_t child;
  int initial_wait, exec_wait, exit_wait, final_wait;
  unsigned waits, continues;
  int reaped, cleanup_attempted, parent_ready, child_ready, object_ready;
  struct context parent, child_context;
  struct stat tracer_object, child_object;
  const char *status, *failure, *ptrace_operation;
  int error_number, ptrace_error, cleanup_signal_error;
  long ptrace_result;
};

static void interrupted(int signal_number) { cancelled = signal_number; }

static void fail(struct probe *p, const char *status, const char *stage, int error) {
  if (p->failure == NULL) {
    p->status = status;
    p->failure = stage;
    p->error_number = error;
  }
}

static int64_t clock_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return -1;
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}

static int read_text(const char *name, char *buffer, size_t capacity) {
  int fd = open(name, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  size_t length = 0;
  while (length < capacity - 1) {
    ssize_t count = read(fd, buffer + length, capacity - 1 - length);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) { int error = errno; close(fd); errno = error; return 0; }
    if (count == 0) { buffer[length] = '\0'; return close(fd) == 0; }
    length += (size_t)count;
  }
  close(fd);
  errno = EOVERFLOW;
  return 0;
}

static int read_context(pid_t pid, struct context *value) {
  char filename[128], status[8192];
  snprintf(filename, sizeof(filename), "/proc/%jd/status", (intmax_t)pid);
  if (!read_text(filename, status, sizeof(status))) return 0;
  char *uid = strstr(status, "\nUid:");
  char *gid = strstr(status, "\nGid:");
  char *tracer = strstr(status, "\nTracerPid:");
  if (uid == NULL || gid == NULL || tracer == NULL ||
      sscanf(uid, "\nUid: %u %u %u %u", &value->uid[0], &value->uid[1], &value->uid[2], &value->uid[3]) != 4 ||
      sscanf(gid, "\nGid: %u %u %u %u", &value->gid[0], &value->gid[1], &value->gid[2], &value->gid[3]) != 4 ||
      sscanf(tracer, "\nTracerPid: %ld", &value->tracer) != 1) {
    errno = EPROTO;
    return 0;
  }
  snprintf(filename, sizeof(filename), "/proc/%jd/uid_map", (intmax_t)pid);
  if (!read_text(filename, value->uid_map, sizeof(value->uid_map))) return 0;
  snprintf(filename, sizeof(filename), "/proc/%jd/ns/user", (intmax_t)pid);
  ssize_t length = readlink(filename, value->user_namespace, sizeof(value->user_namespace) - 1);
  if (length < 0) return 0;
  if ((size_t)length >= sizeof(value->user_namespace) - 1) { errno = EOVERFLOW; return 0; }
  value->user_namespace[length] = '\0';
  return 1;
}

static int next_wait(struct probe *p, int64_t deadline, int cleanup) {
  for (;;) {
    if (!cleanup && cancelled) { fail(p, "cancelled", "wait", 0); return -1; }
    int64_t now = clock_ms();
    if (now < 0) { fail(p, "refused", "clock", errno); return -1; }
    if (now >= deadline) { fail(p, "timed_out", cleanup ? "cleanup_wait" : "wait", 0); return -1; }
    int status;
    pid_t observed = waitpid(p->child, &status, WNOHANG | __WALL);
    if (observed == p->child) {
      p->waits++;
      if (WIFEXITED(status) || WIFSIGNALED(status)) {
        p->reaped = 1;
        p->final_wait = status;
      }
      return status;
    }
    if (observed < 0 && errno != EINTR) { fail(p, "refused", "waitpid", errno); return -1; }
    const struct timespec pause = { .tv_sec = 0, .tv_nsec = 5000000 };
    if (nanosleep(&pause, NULL) != 0 && errno != EINTR) { fail(p, "refused", "wait_sleep", errno); return -1; }
  }
}

static int trace(struct probe *p, int request, void *data, const char *operation) {
  errno = 0;
  p->ptrace_operation = operation;
  p->ptrace_result = ptrace(request, p->child, NULL, data);
  p->ptrace_error = p->ptrace_result == -1 ? errno : 0;
  if (p->ptrace_result != 0) {
    fail(p, "refused", operation, p->ptrace_error);
    return 0;
  }
  if (request == PTRACE_CONT) p->continues++;
  return 1;
}

static void stop_owned_child(struct probe *p) {
  if (p->child <= 0 || p->reaped) return;
  p->cleanup_attempted = 1;
  if (kill(p->child, SIGKILL) != 0) p->cleanup_signal_error = errno;
  int64_t now = clock_ms();
  if (now < 0) { fail(p, "refused", "cleanup_clock", errno); return; }
  int64_t deadline = now + CLEANUP_MS;
  while (!p->reaped) {
    int status = next_wait(p, deadline, 1);
    if (status < 0) return;
    if (WIFSTOPPED(status)) trace(p, PTRACE_CONT, NULL, "cleanup_continue");
  }
}

static void json_string(const char *value) {
  if (value == NULL) { fputs("null", stdout); return; }
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p < 0x20) printf("\\u%04x", (unsigned)*p);
    else putchar(*p);
  }
  putchar('"');
}

static void context_json(const struct context *value, int ready) {
  if (!ready) { fputs("null", stdout); return; }
  printf("{\"uid\":[%u,%u,%u,%u],\"gid\":[%u,%u,%u,%u],\"tracerPid\":%ld,\"userNamespace\":",
         value->uid[0], value->uid[1], value->uid[2], value->uid[3],
         value->gid[0], value->gid[1], value->gid[2], value->gid[3], value->tracer);
  json_string(value->user_namespace);
  fputs(",\"uidMap\":", stdout);
  json_string(value->uid_map);
  putchar('}');
}

static void wait_json(int status) {
  if (status < 0) fputs("null", stdout);
  else printf("%d", status);
}

static int report(struct probe *p) {
  if (cancelled) fail(p, "cancelled", "report", 0);
  fputs("{\"schemaVersion\":1,\"platform\":\"linux\",\"qualified\":false,\"status\":", stdout);
  json_string(p->status);
  printf(",\"tracerPid\":%jd,\"childPid\":", (intmax_t)getpid());
  if (p->child > 0) printf("%jd", (intmax_t)p->child); else fputs("null", stdout);
  fputs(",\"initialWait\":", stdout); wait_json(p->initial_wait);
  fputs(",\"execWait\":", stdout); wait_json(p->exec_wait);
  fputs(",\"exitStopWait\":", stdout); wait_json(p->exit_wait);
  fputs(",\"finalWait\":", stdout); wait_json(p->final_wait);
  printf(",\"waitCount\":%u,\"continues\":%u,\"cleanupComplete\":%s,\"cleanupAttempted\":%s,\"cleanupSignalErrno\":%d,\"cancelSignal\":%d,\"workLimitMs\":%d,\"cleanupLimitMs\":%d,\"parent\":",
         p->waits, p->continues, p->child <= 0 || p->reaped ? "true" : "false",
         p->cleanup_attempted ? "true" : "false", p->cleanup_signal_error, (int)cancelled, WORK_MS, CLEANUP_MS);
  context_json(&p->parent, p->parent_ready);
  fputs(",\"child\":", stdout); context_json(&p->child_context, p->child_ready);
  fputs(",\"executable\":", stdout);
  if (p->object_ready) {
    printf("{\"tracer\":{\"device\":\"%ju\",\"inode\":\"%ju\"},\"child\":{\"device\":\"%ju\",\"inode\":\"%ju\"}}",
           (uintmax_t)p->tracer_object.st_dev, (uintmax_t)p->tracer_object.st_ino,
           (uintmax_t)p->child_object.st_dev, (uintmax_t)p->child_object.st_ino);
  } else fputs("null", stdout);
  fputs(",\"lastPtrace\":", stdout);
  if (p->ptrace_operation != NULL) {
    fputs("{\"operation\":", stdout); json_string(p->ptrace_operation);
    printf(",\"result\":%ld,\"errno\":%d}", p->ptrace_result, p->ptrace_error);
  } else fputs("null", stdout);
  fputs(",\"failure\":", stdout);
  if (p->failure != NULL) {
    fputs("{\"stage\":", stdout); json_string(p->failure);
    fputs(",\"errno\":", stdout);
    if (p->error_number) printf("%d", p->error_number); else fputs("null", stdout);
    putchar('}');
  } else fputs("null", stdout);
  fputs("}\n", stdout);
  if (ferror(stdout) || fflush(stdout) != 0) return 1;
  return p->failure == NULL && p->reaped && !cancelled ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--inert-child") == 0) return 0;
  struct probe p = {
    .child = -1, .initial_wait = -1, .exec_wait = -1, .exit_wait = -1, .final_wait = -1,
    .status = "refused"
  };
  if (argc != 1) { fail(&p, "refused", "arguments", EINVAL); return report(&p); }
  struct sigaction action = { .sa_handler = interrupted };
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) != 0 || sigaction(SIGINT, &action, NULL) != 0) {
    fail(&p, "refused", "signal_handlers", errno);
    return report(&p);
  }
  pid_t owner = getpid();
  if (!read_context(owner, &p.parent)) { fail(&p, "refused", "parent_context", errno); return report(&p); }
  p.parent_ready = 1;
  if (p.parent.tracer != 0) { fail(&p, "refused", "existing_tracer", EBUSY); return report(&p); }
  if (stat("/proc/self/exe", &p.tracer_object) != 0) { fail(&p, "refused", "tracer_object", errno); return report(&p); }
  if (!S_ISREG(p.tracer_object.st_mode) || (p.tracer_object.st_mode & (S_ISUID | S_ISGID))) {
    fail(&p, "refused", "privileged_or_invalid_object", EPERM);
    return report(&p);
  }
  int64_t started = clock_ms();
  if (started < 0) { fail(&p, "refused", "clock", errno); return report(&p); }
  int64_t deadline = started + WORK_MS;
  if (cancelled) { fail(&p, "cancelled", "before_fork", 0); return report(&p); }
  p.child = fork();
  if (p.child < 0) { fail(&p, "refused", "fork", errno); return report(&p); }
  if (p.child == 0) {
    // Cover tracer death before PTRACE_O_EXITKILL can be installed.
    if (prctl(PR_SET_PDEATHSIG, (unsigned long)SIGKILL, 0UL, 0UL, 0UL) != 0 || getppid() != owner) _exit(70);
    if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) != 0) _exit(71);
    if (raise(SIGSTOP) != 0) _exit(72);
    char *const arguments[] = { "/proc/self/exe", "--inert-child", NULL };
    char *const environment[] = { NULL };
    execve("/proc/self/exe", arguments, environment);
    _exit(73);
  }
  p.initial_wait = next_wait(&p, deadline, 0);
  if (p.initial_wait < 0) goto finished;
  if (!WIFSTOPPED(p.initial_wait) || WSTOPSIG(p.initial_wait) != SIGSTOP) {
    fail(&p, "refused", "initial_stop_or_child_setup", 0);
    goto finished;
  }
  uintptr_t options = PTRACE_O_TRACEEXEC | PTRACE_O_TRACEEXIT | PTRACE_O_EXITKILL;
  if (!trace(&p, PTRACE_SETOPTIONS, (void *)options, "set_options") ||
      !trace(&p, PTRACE_CONT, NULL, "continue_initial")) goto finished;
  while (!p.reaped) {
    int status = next_wait(&p, deadline, 0);
    if (status < 0) goto finished;
    if (p.reaped) break;
    unsigned event = (unsigned)status >> 16;
    if (!WIFSTOPPED(status) || WSTOPSIG(status) != SIGTRAP) {
      fail(&p, "refused", "unexpected_stop", 0);
      goto finished;
    }
    if (event == PTRACE_EVENT_EXEC && p.exec_wait < 0 && p.exit_wait < 0) {
      p.exec_wait = status;
      if (!read_context(p.child, &p.child_context)) { fail(&p, "refused", "child_context", errno); goto finished; }
      p.child_ready = 1;
      if (p.child_context.tracer != owner || memcmp(p.parent.uid, p.child_context.uid, sizeof(p.parent.uid)) != 0 ||
          memcmp(p.parent.gid, p.child_context.gid, sizeof(p.parent.gid)) != 0 ||
          strcmp(p.parent.user_namespace, p.child_context.user_namespace) != 0 ||
          strcmp(p.parent.uid_map, p.child_context.uid_map) != 0) {
        fail(&p, "refused", "changed_identity_or_namespace", 0);
        goto finished;
      }
      char executable[128];
      snprintf(executable, sizeof(executable), "/proc/%jd/exe", (intmax_t)p.child);
      if (stat(executable, &p.child_object) != 0) { fail(&p, "refused", "executed_object", errno); goto finished; }
      p.object_ready = 1;
      if (p.tracer_object.st_dev != p.child_object.st_dev || p.tracer_object.st_ino != p.child_object.st_ino) {
        fail(&p, "refused", "executed_object_mismatch", 0);
        goto finished;
      }
    } else if (event == PTRACE_EVENT_EXIT && p.exec_wait >= 0 && p.exit_wait < 0) {
      // This stop is deliberately not accepted as process termination.
      p.exit_wait = status;
    } else {
      fail(&p, "refused", "duplicate_or_unexpected_event", 0);
      goto finished;
    }
    if (!trace(&p, PTRACE_CONT, NULL, "continue_event")) goto finished;
  }
  if (!p.reaped || !WIFEXITED(p.final_wait) || WEXITSTATUS(p.final_wait) != 0 ||
      p.exec_wait < 0 || p.exit_wait < 0 || p.waits != 4 || p.continues != 3) {
    fail(&p, "refused", "final_wait_or_sequence", 0);
    goto finished;
  }
  int64_t completed = clock_ms();
  if (completed < 0) fail(&p, "refused", "final_clock", errno);
  else if (cancelled) fail(&p, "cancelled", "final_acceptance", 0);
  else if (completed >= deadline) fail(&p, "timed_out", "final_acceptance", 0);
  else p.status = "observed";
finished:
  stop_owned_child(&p);
  return report(&p);
}
#else
int main(void) {
  puts("{\"schemaVersion\":1,\"platform\":\"unsupported\",\"status\":\"refused\",\"qualified\":false,\"cleanupComplete\":true,\"childPid\":null,\"failure\":\"linux_required\"}");
  return 77;
}
#endif
