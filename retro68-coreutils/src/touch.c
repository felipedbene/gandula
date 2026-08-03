/*
 * touch file...
 *
 * Creates missing files (as plain text documents, type 'TEXT' creator
 * 'ttxt' on classic Mac OS) or updates the modification time.
 */
#include "gucompat.h"

int gu_main(int argc, char **argv)
{
    int i;
    int status = 0;

    if (argc < 2) {
        gu_warn("usage: touch file...");
        return 1;
    }
    for (i = 1; i < argc; i++) {
        int rc = gu_touch(argv[i]);
        if (rc != GU_OK) {
            gu_warn("%s: %s", argv[i], gu_strerror(rc));
            status = 1;
        }
    }
    return status;
}
