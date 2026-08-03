/*
 * ls [-al] [path...]
 *
 * -a also lists Finder-invisible files (dotfiles on the host build).
 * -l long listing; on classic Mac OS the columns are:
 *      kind  TYPE CREA  data-size  rsrc-size  mod-date  name
 * showing the Finder type/creator codes and both fork sizes.
 */
#include "gucompat.h"

#include <stdlib.h>
#include <string.h>

static int flag_a, flag_l;

static void print_entry(const gu_finfo *fi)
{
    if (!flag_l) {
        printf("%s\n", fi->name);
        return;
    }
    {
        char when[32];
        gu_format_time(fi->mtime, when, sizeof(when));
        if (fi->is_dir) {
            printf("d %4s %4s %9s %9s  %s  %s\n", "-", "-", "-", "-",
                   when, fi->name);
        } else {
            char dsz[16], rsz[16];
            snprintf(dsz, sizeof(dsz), "%ld", fi->size);
            snprintf(rsz, sizeof(rsz), "%ld", fi->rsize);
            printf("- %4s %4s %9s %9s  %s  %s\n",
                   fi->type[0] ? fi->type : "-",
                   fi->creator[0] ? fi->creator : "-",
                   dsz, rsz, when, fi->name);
        }
    }
}

static int cmp_entry(const void *a, const void *b)
{
    return strcmp(((const gu_finfo *)a)->name, ((const gu_finfo *)b)->name);
}

static int list_dir(const char *path)
{
    GUDIR *d;
    gu_finfo fi;
    gu_finfo *entries = NULL;
    long n = 0, cap = 0, i;
    int rc;

    d = gu_opendir(path);
    if (!d) {
        gu_warn("%s: cannot open directory", path);
        return 1;
    }
    while ((rc = gu_readdir(d, &fi)) > 0) {
        if (fi.is_hidden && !flag_a)
            continue;
        if (n == cap) {
            long ncap = cap ? cap * 2 : 64;
            gu_finfo *ne = (gu_finfo *)realloc(entries,
                                               (size_t)ncap * sizeof(gu_finfo));
            if (!ne) {
                gu_warn("out of memory");
                gu_closedir(d);
                free(entries);
                return 1;
            }
            entries = ne;
            cap = ncap;
        }
        entries[n++] = fi;
    }
    gu_closedir(d);
    if (rc < 0) {
        gu_warn("%s: read error", path);
        free(entries);
        return 1;
    }
    qsort(entries, (size_t)n, sizeof(gu_finfo), cmp_entry);
    for (i = 0; i < n; i++)
        print_entry(&entries[i]);
    free(entries);
    return 0;
}

static int list_path(const char *path)
{
    gu_finfo fi;
    int rc = gu_stat(path, &fi);
    if (rc != GU_OK) {
        gu_warn("%s: %s", path, gu_strerror(rc));
        return 1;
    }
    if (fi.is_dir)
        return list_dir(path);
    print_entry(&fi);
    return 0;
}

int gu_main(int argc, char **argv)
{
    int c, i;
    int status = 0;
    int npaths;

    while ((c = gu_getopt(argc, argv, "al")) != -1) {
        switch (c) {
        case 'a': flag_a = 1; break;
        case 'l': flag_l = 1; break;
        default: return 1;
        }
    }
    npaths = argc - gu_optind;
    if (npaths == 0) {
        char cwd[GU_PATH_MAX];
        if (gu_getcwd(cwd, sizeof(cwd)) != GU_OK) {
            gu_warn("cannot determine current directory");
            return 1;
        }
        return list_path(cwd);
    }
    for (i = gu_optind; i < argc; i++) {
        if (npaths > 1)
            printf("%s%s:\n", i > gu_optind ? "\n" : "", argv[i]);
        status |= list_path(argv[i]);
    }
    return status;
}
