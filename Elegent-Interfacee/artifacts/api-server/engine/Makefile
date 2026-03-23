CXX      = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra -pthread -I./include
SRCS     = src/main.cpp
BUILD    = build

ifeq ($(OS),Windows_NT)
  TARGET   = uqlengine.exe
  LDFLAGS  = -lws2_32
  MKDIR    = if not exist $(BUILD) mkdir $(BUILD)
else
  TARGET   = uqlengine
  LDFLAGS  =
  MKDIR    = mkdir -p $(BUILD)
endif

.PHONY: all clean

all: $(BUILD)/$(TARGET)

$(BUILD)/$(TARGET): $(SRCS) src/types.h src/page_manager.h src/wal.h src/btree.h src/transaction.h src/storage.h
	$(MKDIR)
	$(CXX) $(CXXFLAGS) $(SRCS) -o $(BUILD)/$(TARGET) $(LDFLAGS)
	@echo "UQL Engine built: $(BUILD)/$(TARGET)"

clean:
	rm -rf $(BUILD)
