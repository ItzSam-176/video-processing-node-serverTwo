FROM node:18-slim

WORKDIR /app

# Copy everything
COPY . ./

# Make build script executable and run it
RUN chmod +x ./build.sh && ./build.sh

# Create required directories
RUN mkdir -p temp uploads processed models

# Pre-download Whisper model
RUN npx nodejs-whisper download tiny

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
