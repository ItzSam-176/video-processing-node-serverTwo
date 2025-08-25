# ========================
# 1. Builder stage
# ========================
FROM debian:bullseye AS builder

RUN apt-get update && apt-get install -y \
  git \
  cmake \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git

WORKDIR /opt/whisper.cpp
# Force static linking
RUN make clean && \
    make -j GGML_STATIC=1

# ========================
# 2. Runtime stage
# ========================
FROM node:20-bullseye AS runtime

RUN apt-get update && apt-get install -y \
  ffmpeg \
  python3 \
  ca-certificates \
  curl \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Copy static whisper-cli only (no libs needed)
COPY --from=builder /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

RUN npx nodejs-whisper download tiny

COPY . ./
RUN mkdir -p temp uploads processed models

ENV NODE_ENV=production
ENV PATH="/usr/local/bin:${PATH}"

EXPOSE 5000
CMD ["node", "server.js"]
