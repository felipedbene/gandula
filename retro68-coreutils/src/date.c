/* date — print the current date and time */
#include "gucompat.h"

int gu_main(int argc, char **argv)
{
    char buf[64];

    (void)argc;
    (void)argv;
    gu_format_date_full(gu_now(), buf, sizeof(buf));
    printf("%s\n", buf);
    return 0;
}
