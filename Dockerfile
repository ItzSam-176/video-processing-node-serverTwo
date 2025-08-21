FROM node:18-alpine

# Install minimal dependencies
RUN apk add --no-cache python3 py3-pip ffmpeg

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --production --silent

# Copy source code
COPY . ./

# Create directories
RUN mkdir -p temp uploads processed models

# Install whisper efficiently
RUN pip install --break-system-packages openai-whisper

# Download model at build time (small model)
RUN npx nodejs-whisper download tiny

EXPOSE 5000
CMD ["node", "server.js"]
