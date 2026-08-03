/*
 * compat_mac.c — Classic Mac OS (System 7 – Mac OS 9) implementation of
 * the gucompat layer, built with Retro68 against the HFS File Manager.
 *
 * Conventions that differ from POSIX and are surfaced through this layer:
 *   - Paths use HFS syntax: "Macintosh HD:Documents:notes" is absolute
 *     (first segment is a volume), ":sub:file" and "file" are relative
 *     to the tool's default directory (the folder it was launched from).
 *   - Files have two forks. gu_copyfile copies the data fork, the
 *     resource fork and the Finder info (type/creator/flags).
 *   - Timestamps are seconds since Jan 1 1904 (the Mac epoch); they are
 *     only ever formatted through gu_format_* so tools never care.
 */
#ifdef GU_MACOS

#include "gucompat.h"

#include <stdlib.h>
#include <string.h>

#include <Files.h>
#include <Script.h>
#include <OSUtils.h>
#include <DateTimeUtils.h>
#include <Gestalt.h>

#define GU_FINDER_INVISIBLE 0x4000

/* ---- small helpers ---------------------------------------------------- */

static void c2p(const char *s, Str255 p)
{
    size_t len = strlen(s);
    if (len > 255)
        len = 255;
    p[0] = (unsigned char)len;
    memcpy(p + 1, s, len);
}

static void p2c(ConstStr255Param p, char *buf, int cap)
{
    int len = p[0];
    if (len > cap - 1)
        len = cap - 1;
    memcpy(buf, p + 1, (size_t)len);
    buf[len] = '\0';
}

static int map_oserr(OSErr e)
{
    switch (e) {
    case noErr:     return GU_OK;
    case fnfErr:
    case dirNFErr:
    case nsvErr:    return GU_ENOENT;
    case dupFNErr:  return GU_EEXIST;
    case fBsyErr:   return GU_ENOTEMPTY;
    case dirFulErr: return GU_ERR;
    default:        return GU_ERR;
    }
}

/* Resolve a C-string path to an FSSpec. Returns the raw OSErr so callers
 * can distinguish "does not exist but parent does" (fnfErr, spec still
 * valid for create operations). */
static OSErr spec_from_path(const char *path, FSSpec *spec)
{
    Str255 pname;
    c2p(path, pname);
    return FSMakeFSSpec(0, 0, pname, spec);
}

static OSErr cat_info_for_spec(const FSSpec *spec, CInfoPBRec *pb, Str255 name)
{
    memset(pb, 0, sizeof(*pb));
    memcpy(name, spec->name, spec->name[0] + 1);
    pb->hFileInfo.ioNamePtr = name;
    pb->hFileInfo.ioVRefNum = spec->vRefNum;
    pb->hFileInfo.ioDirID = spec->parID;
    pb->hFileInfo.ioFDirIndex = 0;
    return PBGetCatInfoSync(pb);
}

static void ostype_to_str(unsigned long t, char *out)
{
    out[0] = (char)((t >> 24) & 0xFF);
    out[1] = (char)((t >> 16) & 0xFF);
    out[2] = (char)((t >> 8) & 0xFF);
    out[3] = (char)(t & 0xFF);
    out[4] = '\0';
}

static void fill_info_from_pb(gu_finfo *out, const CInfoPBRec *pb,
                              ConstStr255Param name)
{
    memset(out, 0, sizeof(*out));
    p2c(name, out->name, sizeof(out->name));
    if (pb->hFileInfo.ioFlAttrib & ioDirMask) {
        out->is_dir = 1;
        out->mtime = (unsigned long)pb->dirInfo.ioDrMdDat;
        out->is_hidden =
            (pb->dirInfo.ioDrUsrWds.frFlags & GU_FINDER_INVISIBLE) != 0;
    } else {
        out->size = pb->hFileInfo.ioFlLgLen;
        out->rsize = pb->hFileInfo.ioFlRLgLen;
        out->mtime = (unsigned long)pb->hFileInfo.ioFlMdDat;
        out->is_hidden =
            (pb->hFileInfo.ioFlFndrInfo.fdFlags & GU_FINDER_INVISIBLE) != 0;
        ostype_to_str((unsigned long)pb->hFileInfo.ioFlFndrInfo.fdType,
                      out->type);
        ostype_to_str((unsigned long)pb->hFileInfo.ioFlFndrInfo.fdCreator,
                      out->creator);
    }
}

/* ---- metadata ---------------------------------------------------------- */

int gu_stat(const char *path, gu_finfo *out)
{
    FSSpec spec;
    CInfoPBRec pb;
    Str255 name;
    OSErr e;

    e = spec_from_path(path, &spec);
    if (e != noErr)
        return map_oserr(e);
    e = cat_info_for_spec(&spec, &pb, name);
    if (e != noErr)
        return map_oserr(e);
    fill_info_from_pb(out, &pb, spec.name);
    return GU_OK;
}

/* ---- directory iteration ----------------------------------------------- */

struct GUDIR {
    short vRefNum;
    long dirID;
    int index;
};

GUDIR *gu_opendir(const char *path)
{
    FSSpec spec;
    CInfoPBRec pb;
    Str255 name;
    GUDIR *d;

    if (spec_from_path(path, &spec) != noErr)
        return NULL;
    if (cat_info_for_spec(&spec, &pb, name) != noErr)
        return NULL;
    if (!(pb.hFileInfo.ioFlAttrib & ioDirMask))
        return NULL;
    d = (GUDIR *)calloc(1, sizeof(GUDIR));
    if (!d)
        return NULL;
    d->vRefNum = spec.vRefNum;
    d->dirID = pb.dirInfo.ioDrDirID;
    d->index = 0;
    return d;
}

int gu_readdir(GUDIR *d, gu_finfo *out)
{
    CInfoPBRec pb;
    Str255 name;
    OSErr e;

    d->index++;
    memset(&pb, 0, sizeof(pb));
    name[0] = 0;
    pb.hFileInfo.ioNamePtr = name;
    pb.hFileInfo.ioVRefNum = d->vRefNum;
    pb.hFileInfo.ioDirID = d->dirID;   /* clobbered on return, reset per call */
    pb.hFileInfo.ioFDirIndex = (short)d->index;
    e = PBGetCatInfoSync(&pb);
    if (e == fnfErr)
        return 0;                      /* past the last entry */
    if (e != noErr)
        return map_oserr(e);
    fill_info_from_pb(out, &pb, name);
    return 1;
}

void gu_closedir(GUDIR *d)
{
    free(d);
}

/* ---- filesystem operations --------------------------------------------- */

int gu_mkdir(const char *path)
{
    FSSpec spec;
    long newDirID;
    OSErr e;

    e = spec_from_path(path, &spec);
    if (e == noErr)
        return GU_EEXIST;
    if (e != fnfErr)
        return map_oserr(e);
    return map_oserr(FSpDirCreate(&spec, smSystemScript, &newDirID));
}

int gu_delete(const char *path)
{
    FSSpec spec;
    OSErr e;

    e = spec_from_path(path, &spec);
    if (e != noErr)
        return map_oserr(e);
    return map_oserr(FSpDelete(&spec));
}

static OSErr copy_fork(short in, short out)
{
    static char buf[8192];
    long count;
    OSErr e;

    for (;;) {
        count = (long)sizeof(buf);
        e = FSRead(in, &count, buf);
        if (e != noErr && e != eofErr)
            return e;
        if (count > 0) {
            long w = count;
            OSErr we = FSWrite(out, &w, buf);
            if (we != noErr)
                return we;
        }
        if (e == eofErr)
            return noErr;
    }
}

int gu_copyfile(const char *src, const char *dst)
{
    FSSpec s, d;
    FInfo fi;
    OSErr e;
    short in, out;

    e = spec_from_path(src, &s);
    if (e != noErr)
        return map_oserr(e);
    e = spec_from_path(dst, &d);
    if (e != noErr && e != fnfErr)
        return map_oserr(e);

    if (FSpGetFInfo(&s, &fi) != noErr) {
        fi.fdType = 'TEXT';
        fi.fdCreator = 'ttxt';
    }
    (void)FSpDelete(&d);               /* replace an existing target */
    e = FSpCreate(&d, fi.fdCreator, fi.fdType, smSystemScript);
    if (e != noErr)
        return map_oserr(e);

    /* Data fork. */
    e = FSpOpenDF(&s, fsRdPerm, &in);
    if (e != noErr)
        return map_oserr(e);
    e = FSpOpenDF(&d, fsWrPerm, &out);
    if (e != noErr) {
        FSClose(in);
        return map_oserr(e);
    }
    e = copy_fork(in, out);
    FSClose(in);
    FSClose(out);
    if (e != noErr)
        return map_oserr(e);

    /* Resource fork (may legitimately be empty). */
    if (FSpOpenRF(&s, fsRdPerm, &in) == noErr) {
        if (FSpOpenRF(&d, fsWrPerm, &out) == noErr) {
            e = copy_fork(in, out);
            FSClose(out);
        }
        FSClose(in);
        if (e != noErr)
            return map_oserr(e);
    }

    (void)FSpSetFInfo(&d, &fi);        /* keep Finder flags, icon pos, ... */
    return GU_OK;
}

static int same_pstr(ConstStr255Param a, ConstStr255Param b)
{
    return a[0] == b[0] && memcmp(a + 1, b + 1, a[0]) == 0;
}

int gu_move(const char *src, const char *dst)
{
    FSSpec s, d;
    OSErr e;

    e = spec_from_path(src, &s);
    if (e != noErr)
        return map_oserr(e);
    e = spec_from_path(dst, &d);
    if (e != noErr && e != fnfErr)
        return map_oserr(e);

    if (s.vRefNum != d.vRefNum) {
        /* Cross-volume: copy + delete, single files only. */
        gu_finfo fi;
        int rc = gu_stat(src, &fi);
        if (rc != GU_OK)
            return rc;
        if (fi.is_dir)
            return GU_EXDEV;
        rc = gu_copyfile(src, dst);
        if (rc != GU_OK)
            return rc;
        return gu_delete(src);
    }

    if (s.parID == d.parID) {
        if (same_pstr(s.name, d.name))
            return GU_OK;
        return map_oserr(HRename(s.vRefNum, s.parID, s.name, d.name));
    }

    /* Same volume, different folder: catalog move, then rename if the
     * target name differs from the source name. */
    {
        CMovePBRec pb;
        memset(&pb, 0, sizeof(pb));
        pb.ioNamePtr = s.name;
        pb.ioVRefNum = s.vRefNum;
        pb.ioDirID = s.parID;
        pb.ioNewName = NULL;
        pb.ioNewDirID = d.parID;
        e = PBCatMoveSync(&pb);
        if (e != noErr)
            return map_oserr(e);
    }
    if (!same_pstr(s.name, d.name))
        return map_oserr(HRename(s.vRefNum, d.parID, s.name, d.name));
    return GU_OK;
}

int gu_touch(const char *path)
{
    FSSpec spec;
    CInfoPBRec pb;
    Str255 name;
    unsigned long now;
    OSErr e;

    e = spec_from_path(path, &spec);
    if (e == fnfErr)
        return map_oserr(FSpCreate(&spec, 'ttxt', 'TEXT', smSystemScript));
    if (e != noErr)
        return map_oserr(e);

    e = cat_info_for_spec(&spec, &pb, name);
    if (e != noErr)
        return map_oserr(e);
    GetDateTime(&now);
    pb.hFileInfo.ioFlMdDat = (long)now;
    pb.hFileInfo.ioDirID = spec.parID;   /* reset: Get clobbered it */
    return map_oserr(PBSetCatInfoSync(&pb));
}

int gu_getcwd(char *buf, int cap)
{
    short vRefNum;
    long dirID;
    Str255 name;
    char seg[GU_NAME_MAX + 1];
    char tmp[GU_PATH_MAX];
    int pos = (int)sizeof(tmp) - 1;

    if (HGetVol(NULL, &vRefNum, &dirID) != noErr)
        return GU_ERR;
    tmp[pos] = '\0';
    for (;;) {
        CInfoPBRec pb;
        int len;
        memset(&pb, 0, sizeof(pb));
        name[0] = 0;
        pb.dirInfo.ioNamePtr = name;
        pb.dirInfo.ioVRefNum = vRefNum;
        pb.dirInfo.ioFDirIndex = -1;    /* look up dirID itself */
        pb.dirInfo.ioDrDirID = dirID;
        if (PBGetCatInfoSync(&pb) != noErr)
            return GU_ERR;
        p2c(name, seg, sizeof(seg));
        len = (int)strlen(seg);
        if (pos - len - 1 < 0)
            return GU_ERR;
        tmp[--pos] = ':';
        pos -= len;
        memcpy(tmp + pos, seg, (size_t)len);
        if (dirID == fsRtDirID)
            break;
        dirID = pb.dirInfo.ioDrParID;
    }
    if ((int)strlen(tmp + pos) > cap - 1)
        return GU_ERR;
    strcpy(buf, tmp + pos);
    return GU_OK;
}

/* ---- time, sleep, system info ------------------------------------------ */

unsigned long gu_now(void)
{
    unsigned long secs;
    GetDateTime(&secs);
    return secs;
}

static const char *k_months[] = {
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
};
static const char *k_days[] = {
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
};

void gu_format_time(unsigned long t, char *buf, int cap)
{
    DateTimeRec d;
    SecondsToDate(t, &d);
    snprintf(buf, (size_t)cap, "%s %2d %4d %02d:%02d",
             k_months[(d.month - 1) % 12], d.day, d.year, d.hour, d.minute);
}

void gu_format_date_full(unsigned long t, char *buf, int cap)
{
    DateTimeRec d;
    SecondsToDate(t, &d);
    snprintf(buf, (size_t)cap, "%s %s %2d %02d:%02d:%02d %4d",
             k_days[(d.dayOfWeek - 1) % 7], k_months[(d.month - 1) % 12],
             d.day, d.hour, d.minute, d.second, d.year);
}

void gu_sleep(unsigned int seconds)
{
    unsigned long final;
    Delay(60L * (long)seconds, &final);   /* ticks are 1/60 s */
}

void gu_uname(char *buf, int cap)
{
    long v = 0;
    const char *arch =
#if defined(__powerpc__) || defined(__ppc__) || defined(powerpc)
        "PowerPC";
#else
        "68K";
#endif
    if (Gestalt(gestaltSystemVersion, &v) == noErr) {
        int major = (int)(((v >> 12) & 0xF) * 10 + ((v >> 8) & 0xF));
        int minor = (int)((v >> 4) & 0xF);
        int bug = (int)(v & 0xF);
        snprintf(buf, (size_t)cap, "Mac OS %d.%d.%d (%s)",
                 major, minor, bug, arch);
    } else {
        snprintf(buf, (size_t)cap, "Mac OS (%s)", arch);
    }
}

#endif /* GU_MACOS */
