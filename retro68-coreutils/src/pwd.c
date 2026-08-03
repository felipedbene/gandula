/*
 * pwd — print the default directory.
 *
 * On classic Mac OS this is the tool's default volume/folder (normally
 * the folder the application was launched from), printed as a full HFS
 * path like "Macintosh HD:Tools:".
 */
#include "gucompat.h"

int gu_main(int argc, char **argv)
{
    char buf[GU_PATH_MAX];

    (void)argc;
    (void)argv;
    if (gu_getcwd(buf, sizeof(buf)) != GU_OK) {
        gu_warn("cannot determine current directory");
        return 1;
    }
    printf("%s\n", buf);
    return 0;
}
