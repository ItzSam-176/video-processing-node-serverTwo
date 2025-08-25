FROM node:20-bullseye

# Install build deps and ffmpeg
RUN apt-get update && apt-get install -y \
  git \
  cmake \
  build-essential \
  python3 \
  ffmpeg \
  ca-certificates \
  curl \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Build whisper.cpp and install whisper-cli
WORKDIR /opt
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git \
  && cd whisper.cpp \
  && make -j \
  && cp main /usr/local/bin/whisper-cli \
  && rm -rf /opt/whisper.cpp

# Setup app
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN npx nodejs-whisper download tiny
COPY . ./

# Create dirs
RUN mkdir -p temp uploads processed models

ENV NODE_ENV=production
ENV PATH="/usr/local/bin:${PATH}"

EXPOSE 5000
CMD ["node", "server.js"]
