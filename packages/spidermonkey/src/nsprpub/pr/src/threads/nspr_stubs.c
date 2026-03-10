/*
 * No-op stubs for NSPR symbols that are referenced but not needed
 * in our single-threaded embedding. All locking, threading, and
 * combined-thread symbols are stubbed as no-ops.
 */

#define FD_SETSIZE 1024

#include "primpl.h"

/* ── Combined-thread entry points (prulock.c, prucv.c, pruthr.c) ── */

PRThread* _PRI_AttachThread(
    PRThreadType type, PRThreadPriority priority,
    PRThreadStack *stack, PRUint32 flags)
{
    return NULL;
}

void _PRI_DetachThread(void)
{
}

void _PR_Schedule(void)
{
}

void _PR_InitLocks(void)
{
}

void _PR_InitStacks(void)
{
}

void _PR_InitThreads(
    PRThreadType type, PRThreadPriority priority,
    PRUintn maxPTDs)
{
}

/* ── Locking primitives (single-threaded: all no-ops) ── */

static PRLock _stub_lock;

PR_IMPLEMENT(PRLock*) PR_NewLock(void)
{
    /* Return a valid pointer so callers don't NULL-check fail */
    return &_stub_lock;
}

PR_IMPLEMENT(void) PR_DestroyLock(PRLock *lock)
{
}

PR_IMPLEMENT(void) PR_Lock(PRLock *lock)
{
}

PR_IMPLEMENT(PRStatus) PR_Unlock(PRLock *lock)
{
    return PR_SUCCESS;
}

PRStatus _PR_InitLock(PRLock *lock)
{
    return PR_SUCCESS;
}

void _PR_FreeLock(PRLock *lock)
{
}

/* ── Condition variables (single-threaded: all no-ops) ── */

static PRCondVar _stub_cvar;

PR_IMPLEMENT(PRCondVar*) PR_NewCondVar(PRLock *lock)
{
    return &_stub_cvar;
}

PR_IMPLEMENT(void) PR_DestroyCondVar(PRCondVar *cvar)
{
}

PR_IMPLEMENT(PRStatus) PR_WaitCondVar(PRCondVar *cvar, PRIntervalTime timeout)
{
    return PR_SUCCESS;
}

PR_IMPLEMENT(PRStatus) PR_NotifyCondVar(PRCondVar *cvar)
{
    return PR_SUCCESS;
}

PR_IMPLEMENT(PRStatus) PR_NotifyAllCondVar(PRCondVar *cvar)
{
    return PR_SUCCESS;
}

PRStatus _PR_InitCondVar(PRCondVar *cvar, PRLock *lock)
{
    return PR_SUCCESS;
}

void _PR_FreeCondVar(PRCondVar *cvar)
{
}

/* ── Thread creation / destruction ── */

PR_IMPLEMENT(PRThread*) PR_CreateThread(
    PRThreadType type,
    void (*start)(void *arg),
    void *arg,
    PRThreadPriority priority,
    PRThreadScope scope,
    PRThreadState state,
    PRUint32 stackSize)
{
    return NULL;
}

PR_IMPLEMENT(PRThread*) _PR_CreateThread(
    PRThreadType type,
    void (*start)(void *arg),
    void *arg,
    PRThreadPriority priority,
    PRThreadScope scope,
    PRThreadState state,
    PRUint32 stackSize,
    PRUint32 flags)
{
    return NULL;
}

void _PR_NativeDestroyThread(PRThread *thread)
{
}

/* ── Cleanup ── */

void _PR_CleanupCPUs(void)
{
}

void _PR_CleanupThreads(void)
{
}

void _PR_CleanupStacks(void)
{
}

/* ── Globals that combined-thread code exports ── */

PRLock *_pr_activeLock = NULL;
PRCondVar *_pr_primordialExitCVar = NULL;
PRInt32 _pr_primordialExitCount = 0;
PRUint32 _pr_cpu_affinity_mask = 0;

/* ── Fiber-safe select (guarded out by _PR_GLOBAL_THREADS_ONLY but still referenced) ── */

int _PR_NTFiberSafeSelect(
    int nfds,
    fd_set *readfds,
    fd_set *writefds,
    fd_set *exceptfds,
    const struct timeval *timeout)
{
    /* Global threads only — just call select directly */
    return select(nfds, readfds, writefds, exceptfds, timeout);
}
