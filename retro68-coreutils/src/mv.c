/*
 * mv src... dst
 *
 * If dst is an existing directory, sources are moved into it. On classic
 * Mac OS a same-volume move is a catalog operation (instant, preserves
 * both forks); a cross-volume move of a single file falls back to
 * copy + delete. Cross-volume directory moves are not supported.
 */
#include "gucompat.h"

#include <string.h>

static int mv_one(const char *src, const char *dst, int dst_is_dir)
{
    char target[GU_PATH_MAX];
    int rc;

    if (dst_is_dir) {
        char base[GU_NAME_MAX + 1];
        gu_basename(src, base, sizeof(base));
        gu_pathjoin(target, sizeof(target), dst, base);
    } else {
        strncpy(target, dst, sizeof(target) - 1);
        target[sizeof(target) - 1] = '\0';
    }
    rc = gu_move(src, target);
    if (rc != GU_OK) {
        gu_warn("cannot move '%s' to '%s': %s", src, target, gu_strerror(rc));
        return 1;
    }
    return 0;
}

int gu_main(int argc, char **argv)
{
    gu_finfo fi;
    int dst_is_dir;
    const char *dst;
    int i;
    int status = 0;

    if (argc < 3) {
        gu_warn("usage: mv src... dst");
        return 1;
    }
    dst = argv[argc - 1];
    dst_is_dir = gu_stat(dst, &fi) == GU_OK && fi.is_dir;
    if (argc > 3 && !dst_is_dir) {
        gu_warn("target '%s' is not a directory", dst);
        return 1;
    }
    for (i = 1; i < argc - 1; i++)
        status |= mv_one(argv[i], dst, dst_is_dir);
    return status;
}
