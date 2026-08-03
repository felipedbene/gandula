/*
 * util.c — getopt clone, path helpers and diagnostics shared by all tools.
 */
#include "gucompat.h"

#include <stdarg.h>
#include <string.h>

/* ---- diagnostics ------------------------------------------------------ */

void gu_warn(const char *fmt, ...)
{
    va_list ap;
    fprintf(stderr, "%s: ", gu_progname);
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
}

const char *gu_strerror(int err)
{
    switch (err) {
    case GU_OK:        return "no error";
    case GU_ENOENT:    return "no such file or directory";
    case GU_EEXIST:    return "file exists";
    case GU_ENOTEMPTY: return "directory not empty";
    case GU_EISDIR:    return "is a directory";
    case GU_ENOTDIR:   return "not a directory";
    case GU_EXDEV:     return "cannot move across volumes";
    default:           return "operation failed";
    }
}

/* ---- getopt ------------------------------------------------------------ */

int gu_optind = 1;
char *gu_optarg = NULL;
static int optpos = 1;

int gu_getopt(int argc, char **argv, const char *opts)
{
    const char *arg;
    const char *p;
    char c;

    gu_optarg = NULL;
    if (gu_optind >= argc)
        return -1;
    arg = argv[gu_optind];
    if (arg[0] != '-' || arg[1] == '\0')
        return -1;
    if (strcmp(arg, "--") == 0) {
        gu_optind++;
        return -1;
    }
    c = arg[optpos];
    p = strchr(opts, c);
    if (!p || c == ':') {
        gu_warn("invalid option -- '%c'", c);
        if (arg[optpos + 1])
            optpos++;
        else {
            gu_optind++;
            optpos = 1;
        }
        return '?';
    }
    if (p[1] == ':') {
        if (arg[optpos + 1]) {
            gu_optarg = (char *)arg + optpos + 1;
        } else if (gu_optind + 1 < argc) {
            gu_optarg = argv[gu_optind + 1];
            gu_optind++;
        } else {
            gu_warn("option requires an argument -- '%c'", c);
            gu_optind++;
            optpos = 1;
            return '?';
        }
        gu_optind++;
        optpos = 1;
    } else {
        if (arg[optpos + 1]) {
            optpos++;
        } else {
            gu_optind++;
            optpos = 1;
        }
    }
    return c;
}

/* ---- path helpers ------------------------------------------------------ */

char gu_pathsep(void)
{
#ifdef GU_MACOS
    return ':';
#else
    return '/';
#endif
}

const char *gu_basename(const char *path, char *buf, int cap)
{
    char sep = gu_pathsep();
    int end = (int)strlen(path);
    int start;
    int len;

    /* Strip trailing separators (but keep a lone root like "/" or "X:"). */
    while (end > 1 && path[end - 1] == sep)
        end--;
    if (end == 0) {
        buf[0] = sep;
        buf[1] = '\0';
        return buf;
    }
    start = end;
    while (start > 0 && path[start - 1] != sep)
        start--;
    len = end - start;
    if (len == 0) {
        /* Path was all separators. */
        buf[0] = sep;
        buf[1] = '\0';
        return buf;
    }
    if (len > cap - 1)
        len = cap - 1;
    memcpy(buf, path + start, (size_t)len);
    buf[len] = '\0';
    return buf;
}

void gu_dirname(const char *path, char *buf, int cap)
{
    char sep = gu_pathsep();
    int end = (int)strlen(path);
    int len;

    while (end > 1 && path[end - 1] == sep)
        end--;
    while (end > 0 && path[end - 1] != sep)
        end--;
    /* end now points just past the last separator of the parent. */
    if (end == 0) {
#ifdef GU_MACOS
        /* HFS: the "current directory" is spelled ":". */
        buf[0] = ':';
#else
        buf[0] = '.';
#endif
        buf[1] = '\0';
        return;
    }
    /* Keep the separator for HFS ("Disk:a:" names a directory) and for
     * the POSIX root; strip it for other POSIX paths. */
    len = end;
#ifndef GU_MACOS
    while (len > 1 && path[len - 1] == sep)
        len--;
#endif
    if (len > cap - 1)
        len = cap - 1;
    memcpy(buf, path, (size_t)len);
    buf[len] = '\0';
}

void gu_pathjoin(char *dst, int cap, const char *dir, const char *name)
{
    char sep = gu_pathsep();
    size_t dlen = strlen(dir);

    if (dlen == 0) {
        strncpy(dst, name, (size_t)cap - 1);
        dst[cap - 1] = '\0';
        return;
    }
    if (dir[dlen - 1] == sep)
        snprintf(dst, (size_t)cap, "%s%s", dir, name);
    else
        snprintf(dst, (size_t)cap, "%s%c%s", dir, sep, name);
}
