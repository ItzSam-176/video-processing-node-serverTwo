# ========================
# 1. Builder stage
# ========================
FROM debian:bullseye AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    git \
    cmake \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Build whisper.cpp
WORKDIR /opt
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git \
    && cd whisper.cpp \
    && make -j


# ========================
# 2. Runtime stage
# ========================
FROM node:20-bullseye AS runtime

# Install runtime dependencies (lighter than full build deps)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    ca-certificates \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy whisper-cli and shared library from builder
COPY --from=builder /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/
COPY --from=builder /opt/whisper.cpp/build/libwhisper.so* /usr/local/lib/

# Update dynamic linker run-time bindings
RUN ldconfig

# Set working directory for the app
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Pre-download the tiny Whisper model (cached separately)
RUN npx nodejs-whisper download tiny

# Copy the app source code
COPY . ./

# Create directories for temp files, uploads, processed files, and models
RUN mkdir -p temp uploads processed models

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/usr/local/bin:${PATH}"

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
