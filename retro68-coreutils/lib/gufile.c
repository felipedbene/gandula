/*
 * gufile.c — buffered read-only file handles over the platform primitive.
 *
 * The buffering and line splitting live here, shared by both platforms;
 * only the raw open/read/close differ. Line splitting understands LF,
 * CR and CRLF so Mac text files read fine on POSIX and vice versa.
 */
#include "gucompat.h"

#include <stdlib.h>
#include <string.h>

#ifdef GU_MACOS
#include <Files.h>
#endif

#define GU_BUFSZ 1024

struct GUFILE {
    FILE *f;                 /* used on POSIX and for the stdin handle */
#ifdef GU_MACOS
    short refnum;
    int is_ref;
#endif
    unsigned char buf[GU_BUFSZ];
    int bpos, blen;
    int eof;
    int is_std;
};

/* ---- raw platform primitives ---------------------------------------- */

static long raw_read(GUFILE *f, void *dst, long n)
{
#ifdef GU_MACOS
    if (f->is_ref) {
        long count = n;
        OSErr e = FSRead(f->refnum, &count, dst);
        if (e == noErr || e == eofErr)
            return count;
        return -1;
    }
#endif
    {
        size_t got = fread(dst, 1, (size_t)n, f->f);
        if (got == 0 && ferror(f->f))
            return -1;
        return (long)got;
    }
}

GUFILE *gu_open(const char *path)
{
    GUFILE *f = (GUFILE *)calloc(1, sizeof(GUFILE));
    if (!f)
        return NULL;
#ifdef GU_MACOS
    {
        FSSpec spec;
        Str255 pname;
        OSErr e;
        size_t len = strlen(path);
        if (len > 255)
            len = 255;
        pname[0] = (unsigned char)len;
        memcpy(pname + 1, path, len);
        e = FSMakeFSSpec(0, 0, pname, &spec);
        if (e != noErr) {
            free(f);
            return NULL;
        }
        e = FSpOpenDF(&spec, fsRdPerm, &f->refnum);
        if (e != noErr) {
            free(f);
            return NULL;
        }
        f->is_ref = 1;
    }
#else
    f->f = fopen(path, "rb");
    if (!f->f) {
        free(f);
        return NULL;
    }
#endif
    return f;
}

GUFILE *gu_stdin(void)
{
    static GUFILE in;
    in.f = stdin;
    in.is_std = 1;
    return &in;
}

void gu_close(GUFILE *f)
{
    if (!f || f->is_std)
        return;
#ifdef GU_MACOS
    if (f->is_ref) {
        FSClose(f->refnum);
        free(f);
        return;
    }
#endif
    if (f->f)
        fclose(f->f);
    free(f);
}

/* ---- buffered access -------------------------------------------------- */

static int fill(GUFILE *f)
{
    long got;
    if (f->eof)
        return 0;
    got = raw_read(f, f->buf, GU_BUFSZ);
    if (got <= 0) {
        f->eof = 1;
        f->bpos = f->blen = 0;
        return got < 0 ? -1 : 0;
    }
    f->bpos = 0;
    f->blen = (int)got;
    return 1;
}

static int gu_getc(GUFILE *f)
{
    if (f->bpos >= f->blen) {
        if (fill(f) <= 0)
            return -1;
    }
    return f->buf[f->bpos++];
}

static int gu_peekc(GUFILE *f)
{
    if (f->bpos >= f->blen) {
        if (fill(f) <= 0)
            return -1;
    }
    return f->buf[f->bpos];
}

long gu_read(GUFILE *f, void *dst, long n)
{
    long done = 0;
    unsigned char *out = (unsigned char *)dst;
    /* Drain anything already buffered first. */
    if (f->bpos < f->blen) {
        long avail = f->blen - f->bpos;
        long take = avail < n ? avail : n;
        memcpy(out, f->buf + f->bpos, (size_t)take);
        f->bpos += (int)take;
        done += take;
    }
    if (done < n && !f->eof) {
        long got = raw_read(f, out + done, n - done);
        if (got < 0)
            return done > 0 ? done : -1;
        if (got == 0)
            f->eof = 1;
        done += got;
    }
    return done;
}

int gu_getline(GUFILE *f, char *buf, int cap)
{
    int len = 0;
    int c = gu_getc(f);
    if (c < 0)
        return -1;
    while (c >= 0) {
        if (c == '\n')
            break;
        if (c == '\r') {
            if (gu_peekc(f) == '\n')
                (void)gu_getc(f);
            break;
        }
        if (len < cap - 1)
            buf[len++] = (char)c;
        else {
            /* Overlong line: return this chunk, resume next call. */
            f->bpos--;   /* push the current char back */
            break;
        }
        c = gu_getc(f);
    }
    buf[len] = '\0';
    return len;
}
