/*
 * compat_posix.c — POSIX implementation of the gucompat layer.
 *
 * This exists so the utilities can be built and tested on a modern
 * machine; the shipping target is compat_mac.c under Retro68.
 */
#ifdef GU_HOST

#include "gucompat.h"

#include <dirent.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>
#include <utime.h>

static int map_errno(void)
{
    switch (errno) {
    case ENOENT:    return GU_ENOENT;
    case EEXIST:    return GU_EEXIST;
    case ENOTEMPTY: return GU_ENOTEMPTY;
    case EISDIR:    return GU_EISDIR;
    case ENOTDIR:   return GU_ENOTDIR;
    case EXDEV:     return GU_EXDEV;
    default:        return GU_ERR;
    }
}

static void fill_info(gu_finfo *out, const char *name, const struct stat *st)
{
    memset(out, 0, sizeof(*out));
    strncpy(out->name, name, GU_NAME_MAX);
    out->size = (long)st->st_size;
    out->is_dir = S_ISDIR(st->st_mode);
    out->is_hidden = name[0] == '.';
    out->mtime = (unsigned long)st->st_mtime;
}

int gu_stat(const char *path, gu_finfo *out)
{
    struct stat st;
    char base[GU_NAME_MAX + 1];
    if (stat(path, &st) != 0)
        return map_errno();
    fill_info(out, gu_basename(path, base, sizeof(base)), &st);
    return GU_OK;
}

struct GUDIR {
    DIR *d;
    char path[GU_PATH_MAX];
};

GUDIR *gu_opendir(const char *path)
{
    GUDIR *gd = (GUDIR *)calloc(1, sizeof(GUDIR));
    if (!gd)
        return NULL;
    gd->d = opendir(path);
    if (!gd->d) {
        free(gd);
        return NULL;
    }
    strncpy(gd->path, path, sizeof(gd->path) - 1);
    return gd;
}

int gu_readdir(GUDIR *gd, gu_finfo *out)
{
    struct dirent *de;
    struct stat st;
    char full[GU_PATH_MAX];

    for (;;) {
        errno = 0;
        de = readdir(gd->d);
        if (!de)
            return errno ? GU_ERR : 0;
        if (strcmp(de->d_name, ".") == 0 || strcmp(de->d_name, "..") == 0)
            continue;
        gu_pathjoin(full, sizeof(full), gd->path, de->d_name);
        if (stat(full, &st) != 0)
            memset(&st, 0, sizeof(st));
        fill_info(out, de->d_name, &st);
        return 1;
    }
}

void gu_closedir(GUDIR *gd)
{
    if (!gd)
        return;
    closedir(gd->d);
    free(gd);
}

int gu_mkdir(const char *path)
{
    if (mkdir(path, 0777) != 0)
        return map_errno();
    return GU_OK;
}

int gu_delete(const char *path)
{
    struct stat st;
    if (stat(path, &st) != 0)
        return map_errno();
    if (S_ISDIR(st.st_mode)) {
        if (rmdir(path) != 0)
            return map_errno();
    } else {
        if (unlink(path) != 0)
            return map_errno();
    }
    return GU_OK;
}

int gu_move(const char *src, const char *dst)
{
    if (rename(src, dst) == 0)
        return GU_OK;
    if (errno == EXDEV) {
        struct stat st;
        int rc;
        if (stat(src, &st) != 0)
            return map_errno();
        if (S_ISDIR(st.st_mode))
            return GU_EXDEV;
        rc = gu_copyfile(src, dst);
        if (rc != GU_OK)
            return rc;
        if (unlink(src) != 0)
            return map_errno();
        return GU_OK;
    }
    return map_errno();
}

int gu_copyfile(const char *src, const char *dst)
{
    FILE *in, *out;
    char buf[8192];
    size_t n;
    int rc = GU_OK;

    in = fopen(src, "rb");
    if (!in)
        return map_errno();
    out = fopen(dst, "wb");
    if (!out) {
        rc = map_errno();
        fclose(in);
        return rc;
    }
    while ((n = fread(buf, 1, sizeof(buf), in)) > 0) {
        if (fwrite(buf, 1, n, out) != n) {
            rc = GU_ERR;
            break;
        }
    }
    if (ferror(in))
        rc = GU_ERR;
    fclose(in);
    if (fclose(out) != 0 && rc == GU_OK)
        rc = GU_ERR;
    return rc;
}

int gu_touch(const char *path)
{
    FILE *f = fopen(path, "ab");
    if (!f)
        return map_errno();
    fclose(f);
    if (utime(path, NULL) != 0)
        return map_errno();
    return GU_OK;
}

int gu_getcwd(char *buf, int cap)
{
    if (!getcwd(buf, (size_t)cap))
        return GU_ERR;
    return GU_OK;
}

unsigned long gu_now(void)
{
    return (unsigned long)time(NULL);
}

void gu_format_time(unsigned long t, char *buf, int cap)
{
    time_t tt = (time_t)t;
    struct tm *tm = localtime(&tt);
    if (!tm || strftime(buf, (size_t)cap, "%b %e %Y %H:%M", tm) == 0)
        snprintf(buf, (size_t)cap, "?");
}

void gu_format_date_full(unsigned long t, char *buf, int cap)
{
    time_t tt = (time_t)t;
    struct tm *tm = localtime(&tt);
    if (!tm || strftime(buf, (size_t)cap, "%a %b %e %H:%M:%S %Y", tm) == 0)
        snprintf(buf, (size_t)cap, "?");
}

void gu_sleep(unsigned int seconds)
{
    sleep(seconds);
}

void gu_uname(char *buf, int cap)
{
    struct utsname u;
    if (uname(&u) == 0)
        snprintf(buf, (size_t)cap, "%s %s %s (host build)",
                 u.sysname, u.release, u.machine);
    else
        snprintf(buf, (size_t)cap, "unknown (host build)");
}

#endif /* GU_HOST */
