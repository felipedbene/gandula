/*
 * gucompat.h — portability layer for retro68-coreutils.
 *
 * Every utility is written against this API. Two implementations exist:
 *   - compat_mac.c   Classic Mac OS (System 7 – Mac OS 9) via the File
 *                    Manager / Toolbox, compiled with Retro68 (GU_MACOS).
 *   - compat_posix.c POSIX hosts, for development and automated tests
 *                    (GU_HOST).
 */
#ifndef GUCOMPAT_H
#define GUCOMPAT_H

#include <stdio.h>
#include <stddef.h>

#if !defined(GU_MACOS) && !defined(GU_HOST)
#error "define GU_MACOS (Retro68 build) or GU_HOST (POSIX build)"
#endif

#define GU_NAME_MAX 255
#define GU_PATH_MAX 1024
#define GU_LINE_MAX 4096
#define GU_MAX_ARGS 32

/* Error codes returned by the filesystem calls below. */
#define GU_OK          0
#define GU_ERR        (-1)   /* generic failure                */
#define GU_ENOENT     (-2)   /* no such file or directory      */
#define GU_EEXIST     (-3)   /* already exists                 */
#define GU_ENOTEMPTY  (-4)   /* directory not empty            */
#define GU_EISDIR     (-5)   /* is a directory                 */
#define GU_ENOTDIR    (-6)   /* not a directory                */
#define GU_EXDEV      (-7)   /* cross-volume move unsupported  */

const char *gu_strerror(int err);

/* Name of the running tool ("cat", "ls", ...). Set by tool_main.c. */
extern const char *gu_progname;

/* ---- buffered read-only file handle ---------------------------------- */
/* On classic Mac OS this wraps a File Manager refNum (data fork); on     */
/* POSIX it wraps a FILE *. gu_stdin() returns a handle over stdin.       */
typedef struct GUFILE GUFILE;

GUFILE *gu_open(const char *path);          /* NULL on failure           */
GUFILE *gu_stdin(void);
long    gu_read(GUFILE *f, void *buf, long n);   /* 0 = EOF, <0 = error  */
/* Read one line, stripping the terminator. Handles LF, CR and CRLF so
 * both Mac (CR) and Unix (LF) text files work on either platform.
 * Returns the line length, or -1 on EOF with no data. Lines longer than
 * cap-1 are returned in cap-1 sized chunks. */
int     gu_getline(GUFILE *f, char *buf, int cap);
void    gu_close(GUFILE *f);                /* safe on the stdin handle  */

/* ---- file metadata ---------------------------------------------------- */
typedef struct {
    char name[GU_NAME_MAX + 1];
    long size;               /* data fork size in bytes                  */
    long rsize;              /* resource fork size (always 0 on POSIX)   */
    int is_dir;
    int is_hidden;           /* Finder invisible bit; dotfile on POSIX   */
    unsigned long mtime;     /* seconds in the platform's native epoch   */
    char type[5];            /* Finder type code, "" on POSIX            */
    char creator[5];         /* Finder creator code, "" on POSIX         */
} gu_finfo;

int gu_stat(const char *path, gu_finfo *out);

/* ---- directory iteration ---------------------------------------------- */
typedef struct GUDIR GUDIR;
GUDIR *gu_opendir(const char *path);
int    gu_readdir(GUDIR *d, gu_finfo *out); /* 1 = entry, 0 = end, <0 err */
void   gu_closedir(GUDIR *d);

/* ---- filesystem operations -------------------------------------------- */
int gu_mkdir(const char *path);
int gu_delete(const char *path);            /* file or empty directory   */
int gu_move(const char *src, const char *dst);   /* dst = full new path  */
int gu_copyfile(const char *src, const char *dst);  /* on Mac: data fork,
                                               resource fork and Finder
                                               info are all copied      */
int gu_touch(const char *path);             /* create or bump mod time   */
int gu_getcwd(char *buf, int cap);

/* ---- time, sleep, system info ----------------------------------------- */
unsigned long gu_now(void);
/* Short form used by ls -l, e.g. "Aug  3 2026 14:05" */
void gu_format_time(unsigned long t, char *buf, int cap);
/* Long form used by date(1), e.g. "Mon Aug  3 14:05:09 2026" */
void gu_format_date_full(unsigned long t, char *buf, int cap);
void gu_sleep(unsigned int seconds);
void gu_uname(char *buf, int cap);

/* ---- path helpers ------------------------------------------------------ */
/* ':' on classic Mac OS (HFS), '/' on POSIX. */
char gu_pathsep(void);
const char *gu_basename(const char *path, char *buf, int cap);
void gu_dirname(const char *path, char *buf, int cap);
void gu_pathjoin(char *dst, int cap, const char *dir, const char *name);

/* ---- option parsing (tiny getopt clone) -------------------------------- */
extern int gu_optind;
extern char *gu_optarg;
int gu_getopt(int argc, char **argv, const char *opts);

/* ---- diagnostics ------------------------------------------------------- */
void gu_warn(const char *fmt, ...);         /* "prog: msg\n" to stderr    */

/* Entry point implemented by each utility; tool_main.c provides main(). */
int gu_main(int argc, char **argv);

#endif /* GUCOMPAT_H */
