FROM node:18-slim

# Install ALL required system dependencies for video processing with Whisper
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    git \
    python3 \
    ffmpeg \
    wget \
    curl \
@@ -26,11 +28,17 @@
# Create required directories
RUN mkdir -p temp uploads processed models

# Pre-download Whisper model to avoid runtime failures
RUN npx nodejs-whisper download tiny

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]