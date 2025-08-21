#!/bin/bash

echo "🔄 Installing system dependencies..."

# Update package list
apt-get update

# Install ALL required dependencies
apt-get install -y \
    cmake \
    build-essential \
    python3 \
    python3-pip \
    python3-dev \
    python3-setuptools \
    python3-wheel \
    git \
    ffmpeg \
    wget \
    curl \
    ca-certificates \
    pkg-config

# Verify cmake installation
echo "📋 Checking cmake installation..."
cmake --version
if [ $? -ne 0 ]; then
    echo "❌ CMake installation failed!"
    exit 1
fi

# Install Node dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install OpenAI Whisper
echo "🎤 Installing OpenAI Whisper..."
pip3 install --break-system-packages openai-whisper

# Verify Whisper installation
echo "🔍 Verifying Whisper installation..."
whisper --help
if [ $? -ne 0 ]; then
    echo "❌ Whisper installation failed!"
    exit 1
fi

echo "✅ Build complete with CMake, FFmpeg, and Whisper"
