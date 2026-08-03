/*
 * sleep seconds
 *
 * Note: classic Mac OS multitasking is cooperative; this blocks inside
 * Delay(), which is fine for a console tool but does starve background
 * apps until it returns.
 */
#include "gucompat.h"

#include <stdlib.h>

int gu_main(int argc, char **argv)
{
    long secs;

    if (argc < 2) {
        gu_warn("usage: sleep seconds");
        return 1;
    }
    secs = atol(argv[1]);
    if (secs < 0) {
        gu_warn("invalid time interval '%s'", argv[1]);
        return 1;
    }
    gu_sleep((unsigned int)secs);
    return 0;
}
