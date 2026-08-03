#!/usr/bin/env bash
# Host-build test suite for retro68-coreutils. Run via `make test`.
set -u

cd "$(dirname "$0")/.."
BIN=$PWD/bin
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # label expected actual
    if [ "$2" = "$3" ]; then
        echo "ok   $1"
    else
        echo "FAIL $1"
        echo "     expected: $(printf '%q' "$2")"
        echo "     actual:   $(printf '%q' "$3")"
        fail=1
    fi
}
check_status() { # label expected actual
    check "$1" "exit=$2" "exit=$3"
}

# --- true / false ----------------------------------------------------------
"$BIN/true";  check_status "true exits 0" 0 $?
"$BIN/false"; check_status "false exits 1" 1 $?

# --- echo ------------------------------------------------------------------
check "echo"     "hello world" "$("$BIN/echo" hello world)"
check "echo -n"  "abc" "$("$BIN/echo" -n abc)"

# --- cat (LF, CR and CRLF inputs) ------------------------------------------
printf 'one\ntwo\n'   > "$TMP/lf.txt"
printf 'one\rtwo\r'   > "$TMP/cr.txt"
printf 'one\r\ntwo\r\n' > "$TMP/crlf.txt"
check "cat lf"    "$(printf 'one\ntwo')" "$("$BIN/cat" "$TMP/lf.txt")"
check "cat cr"    "$(printf 'one\ntwo')" "$("$BIN/cat" "$TMP/cr.txt")"
check "cat crlf"  "$(printf 'one\ntwo')" "$("$BIN/cat" "$TMP/crlf.txt")"
check "cat -n"    "$(printf '     1\tone\n     2\ttwo')" \
                  "$("$BIN/cat" -n "$TMP/lf.txt")"
check "cat stdin" "hi" "$(printf 'hi\n' | "$BIN/cat")"
"$BIN/cat" "$TMP/nonexistent" 2>/dev/null
check_status "cat missing file exits 1" 1 $?

# --- head / tail -------------------------------------------------------------
seq 1 20 > "$TMP/twenty.txt"
check "head default" "$(seq 1 10)" "$("$BIN/head" "$TMP/twenty.txt")"
check "head -n 3"    "$(seq 1 3)"  "$("$BIN/head" -n 3 "$TMP/twenty.txt")"
check "head -3"      "$(seq 1 3)"  "$("$BIN/head" -3 "$TMP/twenty.txt")"
check "tail default" "$(seq 11 20)" "$("$BIN/tail" "$TMP/twenty.txt")"
check "tail -n 2"    "$(seq 19 20)" "$("$BIN/tail" -n 2 "$TMP/twenty.txt")"
check "tail short"   "$(seq 1 20)"  "$("$BIN/tail" -n 50 "$TMP/twenty.txt")"

# --- wc ----------------------------------------------------------------------
printf 'a b\nc d e\n' > "$TMP/wc.txt"
check "wc -l" "2" "$("$BIN/wc" -l < "$TMP/wc.txt" | tr -d ' ')"
check "wc -w" "5" "$("$BIN/wc" -w < "$TMP/wc.txt" | tr -d ' ')"
check "wc -c" "10" "$("$BIN/wc" -c < "$TMP/wc.txt" | tr -d ' ')"
printf 'a\rb\r' > "$TMP/wcmac.txt"
check "wc -l mac file" "2" "$("$BIN/wc" -l < "$TMP/wcmac.txt" | tr -d ' ')"

# --- sort / uniq --------------------------------------------------------------
printf 'b\na\nc\na\n' > "$TMP/s.txt"
check "sort"    "$(printf 'a\na\nb\nc')" "$("$BIN/sort" "$TMP/s.txt")"
check "sort -r" "$(printf 'c\nb\na\na')" "$("$BIN/sort" -r "$TMP/s.txt")"
check "sort -u" "$(printf 'a\nb\nc')"    "$("$BIN/sort" -u "$TMP/s.txt")"
printf '10\n2\n1\n' > "$TMP/n.txt"
check "sort -n" "$(printf '1\n2\n10')"   "$("$BIN/sort" -n "$TMP/n.txt")"
printf 'a\na\nb\na\n' > "$TMP/u.txt"
check "uniq"    "$(printf 'a\nb\na')" "$("$BIN/uniq" "$TMP/u.txt")"
check "uniq -c" "$(printf '      2 a\n      1 b\n      1 a')" \
                "$("$BIN/uniq" -c "$TMP/u.txt")"
check "uniq -d" "a" "$("$BIN/uniq" -d "$TMP/u.txt")"

# --- basename / dirname ---------------------------------------------------------
check "basename"        "file.txt" "$("$BIN/basename" /a/b/file.txt)"
check "basename suffix" "file"     "$("$BIN/basename" /a/b/file.txt .txt)"
check "basename slash"  "b"        "$("$BIN/basename" /a/b/)"
check "dirname"         "/a/b"     "$("$BIN/dirname" /a/b/file.txt)"
check "dirname bare"    "."        "$("$BIN/dirname" file.txt)"
check "dirname root"    "/"        "$("$BIN/dirname" /file)"

# --- pwd ------------------------------------------------------------------------
check "pwd" "$PWD" "$("$BIN/pwd")"

# --- mkdir / rmdir / touch / ls ---------------------------------------------------
mkdir -p "$TMP/fs" && cd "$TMP/fs"
"$BIN/mkdir" d1
check "mkdir" "yes" "$([ -d d1 ] && echo yes)"
"$BIN/mkdir" -p a/b/c
check "mkdir -p" "yes" "$([ -d a/b/c ] && echo yes)"
"$BIN/mkdir" d1 2>/dev/null
check_status "mkdir existing exits 1" 1 $?
"$BIN/touch" f1.txt
check "touch creates" "yes" "$([ -f f1.txt ] && echo yes)"
touch .hidden
check "ls skips hidden" "$(printf 'a\nd1\nf1.txt')" "$("$BIN/ls" .)"
check "ls -a shows hidden" "$(printf '.hidden\na\nd1\nf1.txt')" "$("$BIN/ls" -a .)"
"$BIN/rmdir" d1
check "rmdir" "yes" "$([ ! -e d1 ] && echo yes)"
"$BIN/rmdir" a 2>/dev/null
check_status "rmdir non-empty exits 1" 1 $?

# --- cp / mv / rm ------------------------------------------------------------------
printf 'data\n' > src.txt
"$BIN/cp" src.txt dst.txt
check "cp file" "data" "$(cat dst.txt)"
"$BIN/cp" -r a acopy
check "cp -r" "yes" "$([ -d acopy/b/c ] && echo yes)"
"$BIN/cp" a nope 2>/dev/null
check_status "cp dir without -r exits 1" 1 $?
"$BIN/mv" dst.txt moved.txt
check "mv rename" "data" "$(cat moved.txt)"
"$BIN/mkdir" into
"$BIN/mv" moved.txt into
check "mv into dir" "data" "$(cat into/moved.txt)"
"$BIN/rm" src.txt
check "rm file" "yes" "$([ ! -e src.txt ] && echo yes)"
"$BIN/rm" acopy 2>/dev/null
check_status "rm dir without -r exits 1" 1 $?
"$BIN/rm" -r acopy
check "rm -r" "yes" "$([ ! -e acopy ] && echo yes)"
"$BIN/rm" nonexistent 2>/dev/null
check_status "rm missing exits 1" 1 $?
"$BIN/rm" -f nonexistent
check_status "rm -f missing exits 0" 0 $?

# --- date / uname / sleep ------------------------------------------------------------
case "$("$BIN/date")" in
    [A-Z][a-z][a-z]\ [A-Z][a-z][a-z]*) echo "ok   date format" ;;
    *) echo "FAIL date format: $("$BIN/date")"; fail=1 ;;
esac
[ -n "$("$BIN/uname")" ] && echo "ok   uname prints something" || { echo "FAIL uname"; fail=1; }
"$BIN/sleep" 0
check_status "sleep 0" 0 $?

echo
if [ "$fail" -eq 0 ]; then
    echo "all tests passed"
else
    echo "TESTS FAILED"
fi
exit "$fail"
