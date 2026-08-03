/* dirname path */
#include "gucompat.h"

int gu_main(int argc, char **argv)
{
    char buf[GU_PATH_MAX];

    if (argc < 2) {
        gu_warn("usage: dirname path");
        return 1;
    }
    gu_dirname(argv[1], buf, sizeof(buf));
    printf("%s\n", buf);
    return 0;
}
