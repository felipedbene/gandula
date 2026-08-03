/* basename path [suffix] */
#include "gucompat.h"

#include <string.h>

int gu_main(int argc, char **argv)
{
    char buf[GU_NAME_MAX + 1];
    const char *base;

    if (argc < 2) {
        gu_warn("usage: basename path [suffix]");
        return 1;
    }
    base = gu_basename(argv[1], buf, sizeof(buf));
    if (argc > 2) {
        size_t blen = strlen(buf);
        size_t slen = strlen(argv[2]);
        if (slen < blen && strcmp(buf + blen - slen, argv[2]) == 0)
            buf[blen - slen] = '\0';
    }
    printf("%s\n", base);
    return 0;
}
