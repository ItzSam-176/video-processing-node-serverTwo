FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    git \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
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

# ✅ BEST PRACTICE: Create virtual environment
RUN python3 -m venv /opt/venv

# ✅ Set PATH to use virtual environment
ENV PATH="/opt/venv/bin:$PATH"

# Install whisper in the virtual environment
RUN pip install --upgrade pip
RUN pip install openai-whisper

# Verify whisper installation
RUN whisper --help

# Pre-download nodejs-whisper model
RUN npx nodejs-whisper download tiny

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
