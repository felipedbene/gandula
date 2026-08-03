/*
 * cp [-r] src... dst
 *
 * On classic Mac OS a file copy preserves the data fork, the resource
 * fork and the Finder info (type, creator, flags) — so copied
 * applications and documents keep their icons and stay double-clickable.
 */
#include "gucompat.h"

#include <string.h>

static int flag_r;

static int cp_path(const char *src, const char *dst);

static int cp_dir(const char *src, const char *dst)
{
    GUDIR *d;
    gu_finfo fi;
    char sc[GU_PATH_MAX], dc[GU_PATH_MAX];
    int rc;
    int status = 0;

    rc = gu_mkdir(dst);
    if (rc != GU_OK && rc != GU_EEXIST) {
        gu_warn("%s: %s", dst, gu_strerror(rc));
        return 1;
    }
    d = gu_opendir(src);
    if (!d) {
        gu_warn("%s: cannot open directory", src);
        return 1;
    }
    while ((rc = gu_readdir(d, &fi)) > 0) {
        gu_pathjoin(sc, sizeof(sc), src, fi.name);
        gu_pathjoin(dc, sizeof(dc), dst, fi.name);
        status |= cp_path(sc, dc);
    }
    gu_closedir(d);
    if (rc < 0) {
        gu_warn("%s: read error", src);
        return 1;
    }
    return status;
}

static int cp_path(const char *src, const char *dst)
{
    gu_finfo fi;
    int rc = gu_stat(src, &fi);

    if (rc != GU_OK) {
        gu_warn("%s: %s", src, gu_strerror(rc));
        return 1;
    }
    if (fi.is_dir) {
        if (!flag_r) {
            gu_warn("%s: %s (use -r)", src, gu_strerror(GU_EISDIR));
            return 1;
        }
        return cp_dir(src, dst);
    }
    rc = gu_copyfile(src, dst);
    if (rc != GU_OK) {
        gu_warn("cannot copy '%s' to '%s': %s", src, dst, gu_strerror(rc));
        return 1;
    }
    return 0;
}

int gu_main(int argc, char **argv)
{
    gu_finfo fi;
    const char *dst;
    int dst_is_dir;
    int c, i;
    int status = 0;

    while ((c = gu_getopt(argc, argv, "r")) != -1) {
        if (c == 'r')
            flag_r = 1;
        else
            return 1;
    }
    if (argc - gu_optind < 2) {
        gu_warn("usage: cp [-r] src... dst");
        return 1;
    }
    dst = argv[argc - 1];
    dst_is_dir = gu_stat(dst, &fi) == GU_OK && fi.is_dir;
    if (argc - gu_optind > 2 && !dst_is_dir) {
        gu_warn("target '%s' is not a directory", dst);
        return 1;
    }
    for (i = gu_optind; i < argc - 1; i++) {
        char target[GU_PATH_MAX];
        if (dst_is_dir) {
            char base[GU_NAME_MAX + 1];
            gu_basename(argv[i], base, sizeof(base));
            gu_pathjoin(target, sizeof(target), dst, base);
        } else {
            strncpy(target, dst, sizeof(target) - 1);
            target[sizeof(target) - 1] = '\0';
        }
        status |= cp_path(argv[i], target);
    }
    return status;
}
