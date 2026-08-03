/*
 * tool_main.c — shared main() for every utility.
 *
 * Classic Mac OS has no shell, so a double-clicked tool starts with no
 * arguments. When that happens on the Mac build, we prompt for a command
 * line in the console window, split it into argv (double quotes group
 * words, so paths with spaces work), and hold the window open at exit so
 * the output can actually be read.
 */
#include "gucompat.h"

#include <string.h>

#ifndef GU_TOOLNAME
#define GU_TOOLNAME "tool"
#endif

const char *gu_progname = GU_TOOLNAME;

#ifdef GU_MACOS
static int split_args(char *line, char **av, int max)
{
    int n = 0;
    char *p = line;
    while (*p && n < max) {
        while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')
            p++;
        if (!*p)
            break;
        if (*p == '"') {
            p++;
            av[n++] = p;
            while (*p && *p != '"')
                p++;
        } else {
            av[n++] = p;
            while (*p && *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n')
                p++;
        }
        if (*p)
            *p++ = '\0';
    }
    return n;
}
#endif

int main(int argc, char **argv)
{
    int status;
#ifdef GU_MACOS
    static char line[512];
    static char *av[GU_MAX_ARGS + 1];

    if (argc <= 1) {
        printf("%s — type arguments and press Return (Return alone for none):\n%s> ",
               gu_progname, gu_progname);
        fflush(stdout);
        if (fgets(line, (int)sizeof(line), stdin)) {
            int n = split_args(line, av + 1, GU_MAX_ARGS);
            av[0] = (char *)gu_progname;
            argc = n + 1;
            argv = av;
        }
    }
    status = gu_main(argc, argv);
    printf("\n[%s exited with status %d — press Return to quit]", gu_progname, status);
    fflush(stdout);
    (void)getchar();
#else
    status = gu_main(argc, argv);
#endif
    return status;
}
