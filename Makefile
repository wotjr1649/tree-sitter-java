ifeq ($(OS),Windows_NT)
$(error Windows is not supported)
endif

LANGUAGE_NAME := tree-sitter-java
DESCRIPTION ?= Java grammar for tree-sitter
HOMEPAGE_URL := https://github.com/wotjr1649/tree-sitter-java
VERSION := 3.0.2

# repository
SRC_DIR := src

TS ?= tree-sitter

# install directory layout
PREFIX ?= /usr/local
INCLUDEDIR ?= include
LIBDIR ?= lib
install_dir = $(if $(filter /%,$(firstword $(1))),$(1),$(patsubst %/,%,$(2))/$(1))
INSTALL_INCLUDEDIR = $(call install_dir,$(INCLUDEDIR),$(PREFIX))
INSTALL_LIBDIR = $(call install_dir,$(LIBDIR),$(PREFIX))
PCLIBDIR ?= $(INSTALL_LIBDIR)/pkgconfig

shell_quote = '$(subst ','"'"',$(1))'

# source/object files
PARSER := $(SRC_DIR)/parser.c
EXTRAS := $(filter-out $(PARSER),$(wildcard $(SRC_DIR)/*.c))
OBJS := $(patsubst %.c,%.o,$(PARSER) $(EXTRAS))

# flags
ARFLAGS ?= rcs
override CFLAGS += -I$(SRC_DIR) -std=c11 -fPIC

# ABI versioning
SONAME_MAJOR = $(shell sed -n 's/\#define LANGUAGE_VERSION //p' $(PARSER))
SONAME_MINOR = $(word 1,$(subst ., ,$(VERSION)))

# OS-specific bits
ifeq ($(shell uname),Darwin)
	SOEXT = dylib
	SOEXTVER_MAJOR = $(SONAME_MAJOR).$(SOEXT)
	SOEXTVER = $(SONAME_MAJOR).$(SONAME_MINOR).$(SOEXT)
	LINKSHARED = -dynamiclib -Wl,-install_name,$(call shell_quote,$(INSTALL_LIBDIR)/lib$(LANGUAGE_NAME).$(SOEXTVER)),-rpath,@executable_path/../Frameworks
else
	SOEXT = so
	SOEXTVER_MAJOR = $(SOEXT).$(SONAME_MAJOR)
	SOEXTVER = $(SOEXT).$(SONAME_MAJOR).$(SONAME_MINOR)
	LINKSHARED = -shared -Wl,-soname,lib$(LANGUAGE_NAME).$(SOEXTVER)
endif
ifneq ($(filter $(shell uname),FreeBSD NetBSD DragonFly),)
	PCLIBDIR := $(PREFIX)/libdata/pkgconfig
endif

all: lib$(LANGUAGE_NAME).a lib$(LANGUAGE_NAME).$(SOEXT) $(LANGUAGE_NAME).pc

lib$(LANGUAGE_NAME).a: $(OBJS)
	$(AR) $(ARFLAGS) $@ $^

lib$(LANGUAGE_NAME).$(SOEXT): $(OBJS)
	$(CC) $(LDFLAGS) $(LINKSHARED) $^ $(LDLIBS) -o $@
ifneq ($(STRIP),)
	$(STRIP) $@
endif

sed_replacement = $(subst |,\|,$(subst &,\&,$(subst \,\\,$(1))))
pc_substitution = $(call shell_quote,s|@$(1)@|$(call sed_replacement,$(2))|)

$(LANGUAGE_NAME).pc: bindings/c/$(LANGUAGE_NAME).pc.in
	sed -e $(call pc_substitution,PROJECT_VERSION,$(VERSION)) \
		-e $(call pc_substitution,PC_LIBDIR,$(call install_dir,$(LIBDIR),$${prefix})) \
		-e $(call pc_substitution,PC_INCLUDEDIR,$(call install_dir,$(INCLUDEDIR),$${prefix})) \
		-e $(call pc_substitution,PROJECT_DESCRIPTION,$(DESCRIPTION)) \
		-e $(call pc_substitution,PROJECT_HOMEPAGE_URL,$(HOMEPAGE_URL)) \
		-e $(call pc_substitution,CMAKE_INSTALL_PREFIX,$(PREFIX)) $< > $@

install: all
	install -d $(call shell_quote,$(DESTDIR)$(INSTALL_INCLUDEDIR))/tree_sitter $(call shell_quote,$(DESTDIR)$(PCLIBDIR)) $(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))
	install -m644 bindings/c/$(LANGUAGE_NAME).h $(call shell_quote,$(DESTDIR)$(INSTALL_INCLUDEDIR))/tree_sitter/$(LANGUAGE_NAME).h
	install -m644 $(LANGUAGE_NAME).pc $(call shell_quote,$(DESTDIR)$(PCLIBDIR))/$(LANGUAGE_NAME).pc
	install -m644 lib$(LANGUAGE_NAME).a $(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).a
	install -m755 lib$(LANGUAGE_NAME).$(SOEXT) $(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).$(SOEXTVER)
	ln -sf lib$(LANGUAGE_NAME).$(SOEXTVER) $(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).$(SOEXTVER_MAJOR)
	ln -sf lib$(LANGUAGE_NAME).$(SOEXTVER_MAJOR) $(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).$(SOEXT)

uninstall:
	$(RM) $(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).a \
		$(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).$(SOEXTVER) \
		$(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).$(SOEXTVER_MAJOR) \
		$(call shell_quote,$(DESTDIR)$(INSTALL_LIBDIR))/lib$(LANGUAGE_NAME).$(SOEXT) \
		$(call shell_quote,$(DESTDIR)$(INSTALL_INCLUDEDIR))/tree_sitter/$(LANGUAGE_NAME).h \
		$(call shell_quote,$(DESTDIR)$(PCLIBDIR))/$(LANGUAGE_NAME).pc

clean:
	$(RM) $(OBJS) $(LANGUAGE_NAME).pc lib$(LANGUAGE_NAME).a lib$(LANGUAGE_NAME).$(SOEXT)

generate:
	$(TS) generate --abi "$$(cat ci/tree-sitter-abi.txt)" --js-runtime native

test:
	$(TS) test

.PHONY: all install uninstall clean generate test $(LANGUAGE_NAME).pc
