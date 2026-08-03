/* mkdir [-p] dir... */
#include "gucompat.h"

#include <string.h>

static int flag_p;

static int mkdir_parents(const char *path)
{
    char buf[GU_PATH_MAX];
    char sep = gu_pathsep();
    size_t len = strlen(path);
    size_t i;
    int rc;

    if (len >= sizeof(buf)) {
        gu_warn("%s: path too long", path);
        return 1;
    }
    /* Create each ancestor in turn, ignoring "already exists". The
     * separator is kept in each prefix: on HFS "Disk:" names a volume
     * while "Disk" would be a relative name, and a trailing separator
     * is harmless on POSIX. Starting at 1 skips the leading ':' of an
     * HFS relative path and the leading '/' of a POSIX absolute one. */
    for (i = 1; i < len; i++) {
        if (path[i] != sep)
            continue;
        memcpy(buf, path, i + 1);
        buf[i + 1] = '\0';
        rc = gu_mkdir(buf);
        if (rc != GU_OK && rc != GU_EEXIST) {
            gu_warn("%s: %s", buf, gu_strerror(rc));
            return 1;
        }
    }
    rc = gu_mkdir(path);
    if (rc != GU_OK && rc != GU_EEXIST) {
        gu_warn("%s: %s", path, gu_strerror(rc));
        return 1;
    }
    return 0;
}

int gu_main(int argc, char **argv)
{
    int c, i;
    int status = 0;

    while ((c = gu_getopt(argc, argv, "p")) != -1) {
        if (c == 'p')
            flag_p = 1;
        else
            return 1;
    }
    if (gu_optind >= argc) {
        gu_warn("usage: mkdir [-p] dir...");
        return 1;
    }
    for (i = gu_optind; i < argc; i++) {
        if (flag_p) {
            status |= mkdir_parents(argv[i]);
        } else {
            int rc = gu_mkdir(argv[i]);
            if (rc != GU_OK) {
                gu_warn("%s: %s", argv[i], gu_strerror(rc));
                status = 1;
            }
        }
    }
    return status;
}
