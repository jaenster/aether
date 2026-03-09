/*
 * Stubs for combined-threads symbols that NSPR references but are unused
 * under the WINNT model with _PR_GLOBAL_THREADS_ONLY.
 */
#include "primpl.h"

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
