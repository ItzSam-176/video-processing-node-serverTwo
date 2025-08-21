FROM node:18-slim

# Install only essential dependencies - avoid Python complications
RUN apt-get update && apt-get install -y \
    ffmpeg \
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

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
