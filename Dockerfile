FROM node:18-slim

# Install ALL required dependencies including whisper-cli
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    git \
    python3 \
    python3-pip \
    python3-dev \
    ffmpeg \
    wget \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --production

# Copy source code
COPY . ./

# Create required directories
RUN mkdir -p temp uploads processed models

# ✅ FIX: Install whisper-cli (this was missing!)
RUN pip3 install --upgrade openai-whisper

# Verify whisper installation
RUN whisper --help

# Pre-download nodejs-whisper model
RUN npx nodejs-whisper download tiny

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
