FROM node:18-alpine

RUN apk add --no-cache python3 py3-pip ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --production --silent

COPY . ./
RUN mkdir -p temp uploads processed models

# Only install whisper, don't download model
RUN pip install --break-system-packages openai-whisper

EXPOSE 5000
CMD ["node", "server.js"]
