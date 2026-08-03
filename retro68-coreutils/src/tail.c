/* tail [-n N] [file]   (also accepts the historical "tail -N") */
#include "gucompat.h"

#include <stdlib.h>
#include <string.h>

static long nlines = 10;

static int tail_one(GUFILE *f)
{
    char **ring;
    char line[GU_LINE_MAX];
    long count = 0;
    long i;

    if (nlines <= 0)
        return 0;
    ring = (char **)calloc((size_t)nlines, sizeof(char *));
    if (!ring) {
        gu_warn("out of memory");
        return 1;
    }
    while (gu_getline(f, line, sizeof(line)) >= 0) {
        long slot = count % nlines;
        size_t len = strlen(line);
        free(ring[slot]);
        ring[slot] = (char *)malloc(len + 1);
        if (!ring[slot]) {
            gu_warn("out of memory");
            return 1;
        }
        memcpy(ring[slot], line, len + 1);
        count++;
    }
    for (i = count > nlines ? count - nlines : 0; i < count; i++)
        printf("%s\n", ring[i % nlines]);
    for (i = 0; i < nlines; i++)
        free(ring[i]);
    free(ring);
    return 0;
}

int gu_main(int argc, char **argv)
{
    int c;
    GUFILE *f;
    int status;

    if (argc > 1 && argv[1][0] == '-' && argv[1][1] >= '0' && argv[1][1] <= '9') {
        nlines = atol(argv[1] + 1);
        gu_optind = 2;
    } else {
        while ((c = gu_getopt(argc, argv, "n:")) != -1) {
            if (c == 'n')
                nlines = atol(gu_optarg);
            else
                return 1;
        }
    }
    if (gu_optind >= argc)
        return tail_one(gu_stdin());
    f = gu_open(argv[gu_optind]);
    if (!f) {
        gu_warn("%s: cannot open", argv[gu_optind]);
        return 1;
    }
    status = tail_one(f);
    gu_close(f);
    return status;
}
