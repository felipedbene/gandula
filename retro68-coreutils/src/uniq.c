/* uniq [-cdu] [file] — filter adjacent duplicate lines */
#include "gucompat.h"

#include <string.h>

static int flag_c, flag_d, flag_u;

static void emit(const char *line, long count)
{
    if (flag_d && count < 2)
        return;
    if (flag_u && count > 1)
        return;
    if (flag_c)
        printf("%7ld %s\n", count, line);
    else
        printf("%s\n", line);
}

int gu_main(int argc, char **argv)
{
    static char prev[GU_LINE_MAX], line[GU_LINE_MAX];
    GUFILE *f;
    long count = 0;
    int have_prev = 0;
    int c;

    while ((c = gu_getopt(argc, argv, "cdu")) != -1) {
        switch (c) {
        case 'c': flag_c = 1; break;
        case 'd': flag_d = 1; break;
        case 'u': flag_u = 1; break;
        default: return 1;
        }
    }
    if (gu_optind < argc) {
        f = gu_open(argv[gu_optind]);
        if (!f) {
            gu_warn("%s: cannot open", argv[gu_optind]);
            return 1;
        }
    } else {
        f = gu_stdin();
    }
    while (gu_getline(f, line, sizeof(line)) >= 0) {
        if (have_prev && strcmp(line, prev) == 0) {
            count++;
            continue;
        }
        if (have_prev)
            emit(prev, count);
        strcpy(prev, line);
        count = 1;
        have_prev = 1;
    }
    if (have_prev)
        emit(prev, count);
    gu_close(f);
    return 0;
}
