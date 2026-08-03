/* rmdir dir... — remove empty directories */
#include "gucompat.h"

int gu_main(int argc, char **argv)
{
    int i;
    int status = 0;

    if (argc < 2) {
        gu_warn("usage: rmdir dir...");
        return 1;
    }
    for (i = 1; i < argc; i++) {
        gu_finfo fi;
        int rc = gu_stat(argv[i], &fi);
        if (rc != GU_OK) {
            gu_warn("%s: %s", argv[i], gu_strerror(rc));
            status = 1;
            continue;
        }
        if (!fi.is_dir) {
            gu_warn("%s: %s", argv[i], gu_strerror(GU_ENOTDIR));
            status = 1;
            continue;
        }
        rc = gu_delete(argv[i]);
        if (rc != GU_OK) {
            gu_warn("%s: %s", argv[i], gu_strerror(rc));
            status = 1;
        }
    }
    return status;
}
