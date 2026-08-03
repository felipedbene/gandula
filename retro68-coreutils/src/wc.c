/*
 * wc [-lwc] [file...]
 *
 * A CR, LF or CRLF each count as one line ending, so Mac and Unix text
 * files report the same counts.
 */
#include "gucompat.h"

#include <string.h>

static int show_l, show_w, show_c;
static long tot_l, tot_w, tot_c;

static void counts(GUFILE *f, long *l, long *w, long *c)
{
    unsigned char buf[1024];
    long got;
    int in_word = 0;
    int prev_cr = 0;

    *l = *w = *c = 0;
    while ((got = gu_read(f, buf, (long)sizeof(buf))) > 0) {
        long i;
        *c += got;
        for (i = 0; i < got; i++) {
            unsigned char ch = buf[i];
            if (ch == '\n') {
                if (!prev_cr)
                    (*l)++;
                prev_cr = 0;
            } else if (ch == '\r') {
                (*l)++;
                prev_cr = 1;
            } else {
                prev_cr = 0;
            }
            if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
                in_word = 0;
            } else if (!in_word) {
                in_word = 1;
                (*w)++;
            }
        }
    }
}

static void report(long l, long w, long c, const char *name)
{
    if (show_l)
        printf("%7ld ", l);
    if (show_w)
        printf("%7ld ", w);
    if (show_c)
        printf("%7ld ", c);
    if (name)
        printf("%s", name);
    printf("\n");
}

int gu_main(int argc, char **argv)
{
    int c, i;
    int status = 0;
    int nfiles;

    while ((c = gu_getopt(argc, argv, "lwc")) != -1) {
        switch (c) {
        case 'l': show_l = 1; break;
        case 'w': show_w = 1; break;
        case 'c': show_c = 1; break;
        default: return 1;
        }
    }
    if (!show_l && !show_w && !show_c)
        show_l = show_w = show_c = 1;

    nfiles = argc - gu_optind;
    if (nfiles == 0) {
        long l, w, cc;
        counts(gu_stdin(), &l, &w, &cc);
        report(l, w, cc, NULL);
        return 0;
    }
    for (i = gu_optind; i < argc; i++) {
        long l, w, cc;
        GUFILE *f = gu_open(argv[i]);
        if (!f) {
            gu_warn("%s: cannot open", argv[i]);
            status = 1;
            continue;
        }
        counts(f, &l, &w, &cc);
        gu_close(f);
        report(l, w, cc, argv[i]);
        tot_l += l;
        tot_w += w;
        tot_c += cc;
    }
    if (nfiles > 1)
        report(tot_l, tot_w, tot_c, "total");
    return status;
}
