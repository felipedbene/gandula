/* echo [-n] [args...] */
#include "gucompat.h"

#include <string.h>

int gu_main(int argc, char **argv)
{
    int i = 1;
    int newline = 1;

    if (i < argc && strcmp(argv[i], "-n") == 0) {
        newline = 0;
        i++;
    }
    for (; i < argc; i++) {
        fputs(argv[i], stdout);
        if (i + 1 < argc)
            fputc(' ', stdout);
    }
    if (newline)
        fputc('\n', stdout);
    return 0;
}
