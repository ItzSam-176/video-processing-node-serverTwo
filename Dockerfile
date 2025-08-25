# ========================
# 1. Builder stage
# ========================
FROM debian:bullseye AS builder

# Install build deps
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

# Install runtime deps only (lighter than full build deps)
RUN apt-get update && apt-get install -y \
  ffmpeg \
  python3 \
  ca-certificates \
  curl \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Copy whisper-cli from builder
COPY --from=builder /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/
COPY --from=builder /opt/whisper.cpp/build/libwhisper.so* /usr/local/lib/
RUN ldconfig

# App setup
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Pre-download the tiny model (cached separately from app source)
RUN npx nodejs-whisper download tiny

# Copy app source
COPY . ./

# Create dirs
RUN mkdir -p temp uploads processed models

ENV NODE_ENV=production
ENV PATH="/usr/local/bin:${PATH}"

EXPOSE 5000
CMD ["node", "server.js"]
