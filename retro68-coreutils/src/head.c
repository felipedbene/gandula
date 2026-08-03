/* head [-n N] [file...]   (also accepts the historical "head -N") */
#include "gucompat.h"

#include <stdlib.h>
#include <string.h>

static long nlines = 10;

static void head_one(GUFILE *f)
{
    char line[GU_LINE_MAX];
    long n = 0;
    while (n < nlines && gu_getline(f, line, sizeof(line)) >= 0) {
        printf("%s\n", line);
        n++;
    }
}

int gu_main(int argc, char **argv)
{
    int c, i;
    int status = 0;

    /* Historical form: head -5 file */
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
    if (gu_optind >= argc) {
        head_one(gu_stdin());
        return 0;
    }
    for (i = gu_optind; i < argc; i++) {
        GUFILE *f = gu_open(argv[i]);
        if (!f) {
            gu_warn("%s: cannot open", argv[i]);
            status = 1;
            continue;
        }
        if (argc - gu_optind > 1)
            printf("==> %s <==\n", argv[i]);
        head_one(f);
        gu_close(f);
    }
    return status;
}
