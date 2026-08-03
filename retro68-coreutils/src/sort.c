/*
 * sort [-nru] [file...]
 *
 * Whole input is held in memory; on a real Mac the ceiling is the
 * application's memory partition (raise it in Get Info if needed).
 */
#include "gucompat.h"

#include <stdlib.h>
#include <string.h>

static int flag_n, flag_r, flag_u;

static char **lines;
static long nline, cap;

static int add_line(const char *s)
{
    char *dup;
    size_t len = strlen(s);
    if (nline == cap) {
        long ncap = cap ? cap * 2 : 256;
        char **nl = (char **)realloc(lines, (size_t)ncap * sizeof(char *));
        if (!nl)
            return -1;
        lines = nl;
        cap = ncap;
    }
    dup = (char *)malloc(len + 1);
    if (!dup)
        return -1;
    memcpy(dup, s, len + 1);
    lines[nline++] = dup;
    return 0;
}

static int read_all(GUFILE *f)
{
    char line[GU_LINE_MAX];
    while (gu_getline(f, line, sizeof(line)) >= 0) {
        if (add_line(line) != 0) {
            gu_warn("out of memory");
            return -1;
        }
    }
    return 0;
}

static int cmp(const void *a, const void *b)
{
    const char *sa = *(const char *const *)a;
    const char *sb = *(const char *const *)b;
    int r;

    if (flag_n) {
        double da = strtod(sa, NULL);
        double db = strtod(sb, NULL);
        r = da < db ? -1 : da > db ? 1 : strcmp(sa, sb);
    } else {
        r = strcmp(sa, sb);
    }
    return flag_r ? -r : r;
}

int gu_main(int argc, char **argv)
{
    int c, i;
    long k;

    while ((c = gu_getopt(argc, argv, "nru")) != -1) {
        switch (c) {
        case 'n': flag_n = 1; break;
        case 'r': flag_r = 1; break;
        case 'u': flag_u = 1; break;
        default: return 1;
        }
    }
    if (gu_optind >= argc) {
        if (read_all(gu_stdin()) != 0)
            return 1;
    } else {
        for (i = gu_optind; i < argc; i++) {
            GUFILE *f = gu_open(argv[i]);
            if (!f) {
                gu_warn("%s: cannot open", argv[i]);
                return 1;
            }
            if (read_all(f) != 0) {
                gu_close(f);
                return 1;
            }
            gu_close(f);
        }
    }
    qsort(lines, (size_t)nline, sizeof(char *), cmp);
    for (k = 0; k < nline; k++) {
        if (flag_u && k > 0 && strcmp(lines[k], lines[k - 1]) == 0)
            continue;
        printf("%s\n", lines[k]);
    }
    return 0;
}
