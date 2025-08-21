FROM node:18-slim

# Install ALL required system dependencies for video processing with Whisper
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    git \
    python3 \
    python3-pip \
    python3-dev \
    python3-setuptools \
    python3-wheel \
    ffmpeg \
    wget \
    curl \
    ca-certificates \
    pkg-config \
    rust-all \
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

# Upgrade pip and setuptools first
RUN python3 -m pip install --upgrade pip setuptools wheel

# Install OpenAI Whisper from GitHub (more reliable than PyPI)
RUN pip3 install "git+https://github.com/openai/whisper.git"

# Verify Whisper installation
RUN whisper --help

# Pre-download Whisper model to avoid runtime failures
RUN npx nodejs-whisper download tiny

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
