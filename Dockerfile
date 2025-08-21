FROM node:18-slim

# Install minimal dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . ./
RUN mkdir -p temp uploads processed models

RUN pip3 install --break-system-packages openai-whisper
RUN npx nodejs-whisper download tiny

EXPOSE 5000
CMD ["node", "server.js"]
