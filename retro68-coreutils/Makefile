# Host (POSIX) build of retro68-coreutils, used for development and the
# automated tests. The Mac OS build goes through CMake + the Retro68
# toolchain — see README.md.

CC ?= cc
CFLAGS ?= -O2 -std=gnu99 -Wall -Wextra

TOOLS = true false echo cat head tail wc sort uniq basename dirname \
        pwd ls mkdir rmdir rm mv cp touch date sleep uname

LIBSRC = lib/gufile.c lib/util.c lib/tool_main.c \
         lib/compat_posix.c lib/compat_mac.c

all: $(TOOLS:%=bin/%)

bin/%: src/%.c $(LIBSRC) include/gucompat.h | bin
	$(CC) $(CFLAGS) -DGU_HOST -DGU_TOOLNAME=\"$*\" -Iinclude \
	    src/$*.c $(LIBSRC) -o $@

bin:
	mkdir -p bin

test: all
	tests/run_tests.sh

clean:
	rm -rf bin

.PHONY: all test clean
