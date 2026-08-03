/* rm [-rf] file... */
#include "gucompat.h"

#include <string.h>

static int flag_r, flag_f;

static int rm_path(const char *path);

static int rm_dir_contents(const char *path)
{
    GUDIR *d;
    gu_finfo fi;
    char child[GU_PATH_MAX];
    int rc;
    int status = 0;

    d = gu_opendir(path);
    if (!d) {
        if (!flag_f)
            gu_warn("%s: cannot open directory", path);
        return flag_f ? 0 : 1;
    }
    /* Restart the scan after each delete: HFS catalog indices shift as
     * entries are removed, so index-based iteration would skip files. */
    for (;;) {
        rc = gu_readdir(d, &fi);
        if (rc <= 0)
            break;
        gu_closedir(d);
        gu_pathjoin(child, sizeof(child), path, fi.name);
        status |= rm_path(child);
        d = gu_opendir(path);
        if (!d)
            break;
    }
    if (d)
        gu_closedir(d);
    return status;
}

static int rm_path(const char *path)
{
    gu_finfo fi;
    int rc = gu_stat(path, &fi);

    if (rc != GU_OK) {
        if (flag_f && rc == GU_ENOENT)
            return 0;
        gu_warn("%s: %s", path, gu_strerror(rc));
        return 1;
    }
    if (fi.is_dir) {
        if (!flag_r) {
            gu_warn("%s: %s", path, gu_strerror(GU_EISDIR));
            return 1;
        }
        if (rm_dir_contents(path) != 0)
            return 1;
    }
    rc = gu_delete(path);
    if (rc != GU_OK) {
        gu_warn("%s: %s", path, gu_strerror(rc));
        return 1;
    }
    return 0;
}

int gu_main(int argc, char **argv)
{
    int c, i;
    int status = 0;

    while ((c = gu_getopt(argc, argv, "rf")) != -1) {
        switch (c) {
        case 'r': flag_r = 1; break;
        case 'f': flag_f = 1; break;
        default: return 1;
        }
    }
    if (gu_optind >= argc) {
        if (flag_f)
            return 0;
        gu_warn("usage: rm [-rf] file...");
        return 1;
    }
    for (i = gu_optind; i < argc; i++)
        status |= rm_path(argv[i]);
    return status;
}
