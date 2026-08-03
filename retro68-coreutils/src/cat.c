/*
 * cat [-n] [file...]
 *
 * Line oriented: input line endings (CR, LF or CRLF) are normalized to
 * the platform's newline on output, so Mac and Unix text files both
 * display correctly. "-" or no operands reads standard input.
 */
#include "gucompat.h"

#include <string.h>

static int number_lines;
static long lineno = 1;

static int cat_one(GUFILE *f)
{
    char line[GU_LINE_MAX];
    while (gu_getline(f, line, sizeof(line)) >= 0) {
        if (number_lines)
            printf("%6ld\t%s\n", lineno++, line);
        else
            printf("%s\n", line);
    }
    return 0;
}

int gu_main(int argc, char **argv)
{
    int c, i;
    int status = 0;

    while ((c = gu_getopt(argc, argv, "n")) != -1) {
        if (c == 'n')
            number_lines = 1;
        else
            return 1;
    }
    if (gu_optind >= argc)
        return cat_one(gu_stdin());
    for (i = gu_optind; i < argc; i++) {
        GUFILE *f;
        if (strcmp(argv[i], "-") == 0) {
            cat_one(gu_stdin());
            continue;
        }
        f = gu_open(argv[i]);
        if (!f) {
            gu_warn("%s: cannot open", argv[i]);
            status = 1;
            continue;
        }
        cat_one(f);
        gu_close(f);
    }
    return status;
}
