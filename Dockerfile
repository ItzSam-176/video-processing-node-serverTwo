FROM node:18-slim

# Install ALL required system dependencies for video processing with nodejs-whisper
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    git \
    python3 \
    ffmpeg \
    wget \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --production

# Copy source code
COPY . ./

# Create required directories
RUN mkdir -p temp uploads processed models

# Pre-download nodejs-whisper model (tiny model for speed)
RUN npx nodejs-whisper download tiny

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
